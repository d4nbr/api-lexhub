import { Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import z from 'zod'

const analyticsQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  agentId: z.union([z.literal('all'), z.string().uuid()]).default('all'),
})

const timeseriesQuerySchema = analyticsQuerySchema.extend({
  groupBy: z.enum(['day', 'month']).default('day'),
})

const topAgentsQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

function getPeriodRange(year: number, month: number) {
  const start = dayjs(`${year}-${String(month).padStart(2, '0')}-01`)
    .startOf('month')
    .toDate()
  const end = dayjs(start).add(1, 'month').toDate()

  const previousStart = dayjs(start).subtract(1, 'month').toDate()
  const previousEnd = start

  return { start, end, previousStart, previousEnd }
}

function getAgentFilter(agentId: string) {
  if (agentId === 'all') {
    return Prisma.empty
  }

  return Prisma.sql`AND s.agent_id = ${agentId}::uuid`
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().register(auth)

  app.withTypeProvider<ZodTypeProvider>().get(
    '/services/analytics/overview',
    {
      schema: {
        tags: ['services'],
        summary: 'Resumo de atendimentos por período com comparação',
        security: [{ bearerAuth: [] }],
        querystring: analyticsQuerySchema,
        response: {
          200: z.object({
            period: z.object({
              year: z.number(),
              month: z.number(),
            }),
            filter: z.object({
              agentId: z.union([z.literal('all'), z.string().uuid()]),
            }),
            totals: z.object({
              current: z.object({
                totalServices: z.number(),
                completedServices: z.number(),
                openServices: z.number(),
              }),
              previous: z.object({
                totalServices: z.number(),
                completedServices: z.number(),
                openServices: z.number(),
              }),
              variation: z.object({
                totalServices: z.number(),
                completedServices: z.number(),
                openServices: z.number(),
              }),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      await request.getCurrentAgentId()

      const { year, month, agentId } = request.query
      const { start, end, previousStart, previousEnd } = getPeriodRange(
        year,
        month
      )

      const currentWhere = {
        createdAt: { gte: start, lt: end },
        ...(agentId === 'all' ? {} : { agentId }),
      }

      const previousWhere = {
        createdAt: { gte: previousStart, lt: previousEnd },
        ...(agentId === 'all' ? {} : { agentId }),
      }

      const [currentTotal, currentCompleted, currentOpen, previousTotal, previousCompleted, previousOpen] =
        await Promise.all([
          prisma.services.count({ where: currentWhere }),
          prisma.services.count({
            where: {
              ...currentWhere,
              status: 'COMPLETED',
            },
          }),
          prisma.services.count({
            where: {
              ...currentWhere,
              status: 'OPEN',
            },
          }),
          prisma.services.count({ where: previousWhere }),
          prisma.services.count({
            where: {
              ...previousWhere,
              status: 'COMPLETED',
            },
          }),
          prisma.services.count({
            where: {
              ...previousWhere,
              status: 'OPEN',
            },
          }),
        ])

      const calcVariation = (current: number, previous: number) => {
        if (previous === 0) {
          return current > 0 ? 100 : 0
        }

        return Number((((current - previous) / previous) * 100).toFixed(2))
      }

      return reply.status(200).send({
        period: { year, month },
        filter: { agentId },
        totals: {
          current: {
            totalServices: currentTotal,
            completedServices: currentCompleted,
            openServices: currentOpen,
          },
          previous: {
            totalServices: previousTotal,
            completedServices: previousCompleted,
            openServices: previousOpen,
          },
          variation: {
            totalServices: calcVariation(currentTotal, previousTotal),
            completedServices: calcVariation(currentCompleted, previousCompleted),
            openServices: calcVariation(currentOpen, previousOpen),
          },
        },
      })
    }
  )

  app.withTypeProvider<ZodTypeProvider>().get(
    '/services/analytics/timeseries',
    {
      schema: {
        tags: ['services'],
        summary: 'Série temporal de atendimentos por período e agrupamento',
        security: [{ bearerAuth: [] }],
        querystring: timeseriesQuerySchema,
        response: {
          200: z.array(
            z.object({
              date: z.string(),
              totalServices: z.number(),
            })
          ),
        },
      },
    },
    async (request, reply) => {
      await request.getCurrentAgentId()

      const { year, month, agentId, groupBy } = request.query
      const { start, end } = getPeriodRange(year, month)
      const agentFilter = getAgentFilter(agentId)
      const groupByFn = groupBy === 'month' ? 'month' : 'day'

      const rows = await prisma.$queryRaw<
        Array<{ bucket: Date; total_services: number }>
      >(Prisma.sql`
        SELECT
          DATE_TRUNC(${groupByFn}, s.created_at) AS bucket,
          COUNT(*)::int AS total_services
        FROM services s
        WHERE s.created_at >= ${start}
          AND s.created_at < ${end}
          ${agentFilter}
        GROUP BY bucket
        ORDER BY bucket ASC
      `)

      return reply.status(200).send(
        rows.map(row => ({
          date: dayjs(row.bucket).format(groupBy === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'),
          totalServices: Number(row.total_services),
        }))
      )
    }
  )

  app.withTypeProvider<ZodTypeProvider>().get(
    '/services/analytics/top-agents',
    {
      schema: {
        tags: ['services'],
        summary: 'Ranking de funcionários com mais atendimentos no período',
        security: [{ bearerAuth: [] }],
        querystring: topAgentsQuerySchema,
        response: {
          200: z.array(
            z.object({
              agentId: z.string().uuid(),
              agentName: z.string(),
              totalServices: z.number(),
            })
          ),
        },
      },
    },
    async (request, reply) => {
      await request.getCurrentAgentId()

      const { year, month, limit } = request.query
      const { start, end } = getPeriodRange(year, month)

      const rows = await prisma.$queryRaw<
        Array<{ agent_id: string; agent_name: string; total_services: number }>
      >(Prisma.sql`
        SELECT
          a.id AS agent_id,
          a.name AS agent_name,
          COUNT(s.id)::int AS total_services
        FROM agents a
        LEFT JOIN services s
          ON s.agent_id = a.id
          AND s.created_at >= ${start}
          AND s.created_at < ${end}
        WHERE a.inactive IS NULL
        GROUP BY a.id, a.name
        ORDER BY total_services DESC, a.name ASC
        LIMIT ${limit}
      `)

      return reply.status(200).send(
        rows.map(row => ({
          agentId: row.agent_id,
          agentName: row.agent_name,
          totalServices: Number(row.total_services),
        }))
      )
    }
  )

  app.withTypeProvider<ZodTypeProvider>().get(
    '/services/analytics/by-service-type',
    {
      schema: {
        tags: ['services'],
        summary: 'Distribuição de atendimentos por tipo de serviço',
        security: [{ bearerAuth: [] }],
        querystring: analyticsQuerySchema,
        response: {
          200: z.array(
            z.object({
              serviceTypeId: z.string(),
              serviceTypeName: z.string(),
              totalServices: z.number(),
            })
          ),
        },
      },
    },
    async (request, reply) => {
      await request.getCurrentAgentId()

      const { year, month, agentId } = request.query
      const { start, end } = getPeriodRange(year, month)
      const agentFilter = getAgentFilter(agentId)

      const rows = await prisma.$queryRaw<
        Array<{
          service_type_id: string
          service_type_name: string
          total_services: number
        }>
      >(Prisma.sql`
        SELECT
          st.id AS service_type_id,
          st.name AS service_type_name,
          COUNT(DISTINCT s.id)::int AS total_services
        FROM service_types st
        LEFT JOIN service_service_types sst ON sst.service_type_id = st.id
        LEFT JOIN services s ON s.id = sst.service_id
          AND s.created_at >= ${start}
          AND s.created_at < ${end}
          ${agentFilter}
        GROUP BY st.id, st.name
        ORDER BY total_services DESC, st.name ASC
      `)

      return reply.status(200).send(
        rows.map(row => ({
          serviceTypeId: row.service_type_id,
          serviceTypeName: row.service_type_name,
          totalServices: Number(row.total_services),
        }))
      )
    }
  )
}
