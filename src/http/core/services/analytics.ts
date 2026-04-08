import { Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import z from 'zod'

const monthQuerySchema = z.union([
  z.literal('all'),
  z.coerce.number().int().min(1).max(12),
])

const analyticsQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: monthQuerySchema,
  agentId: z.union([z.literal('all'), z.string().uuid()]).default('all'),
})

const timeseriesQuerySchema = analyticsQuerySchema.extend({
  groupBy: z.enum(['day', 'month']).default('day'),
})

const topAgentsQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: monthQuerySchema,
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

function getPeriodRange(year: number, month: number | 'all') {
  if (month === 'all') {
    const start = dayjs(`${year}-01-01`).startOf('year').toDate()
    const end = dayjs(start).add(1, 'year').toDate()

    const previousStart = dayjs(start).subtract(1, 'year').toDate()
    const previousEnd = start

    return { start, end, previousStart, previousEnd }
  }

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

  return Prisma.sql`AND s.agent_id = ${agentId}`
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
              month: z.union([z.literal('all'), z.number()]),
            }),
            filter: z.object({
              agentId: z.union([z.literal('all'), z.string().uuid()]),
            }),
            totals: z.object({
              current: z.object({
                totalServices: z.number(),
                externalServices: z.number(),
                averageResolutionMinutes: z.number(),
              }),
              previous: z.object({
                totalServices: z.number(),
                externalServices: z.number(),
                averageResolutionMinutes: z.number(),
              }),
              variation: z.object({
                totalServices: z.number(),
                externalServices: z.number(),
                averageResolutionMinutes: z.number(),
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

      const agentFilter = getAgentFilter(agentId)

      const [
        currentTotal,
        currentExternal,
        previousTotal,
        previousExternal,
        currentAvgTimeRows,
        previousAvgTimeRows,
      ] = await Promise.all([
        prisma.services.count({ where: currentWhere }),
        prisma.services.count({
          where: {
            ...currentWhere,
            assistance: 'REMOTE',
          },
        }),
        prisma.services.count({ where: previousWhere }),
        prisma.services.count({
          where: {
            ...previousWhere,
            assistance: 'REMOTE',
          },
        }),
        prisma.$queryRaw<Array<{ avg_minutes: number | null }>>(Prisma.sql`
          SELECT ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (s.finished_at - s.created_at)) / 60), 0), 2)::float AS avg_minutes
          FROM services s
          WHERE s.created_at >= ${start}
            AND s.created_at < ${end}
            AND s.finished_at IS NOT NULL
            ${agentFilter}
        `),
        prisma.$queryRaw<Array<{ avg_minutes: number | null }>>(Prisma.sql`
          SELECT ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (s.finished_at - s.created_at)) / 60), 0), 2)::float AS avg_minutes
          FROM services s
          WHERE s.created_at >= ${previousStart}
            AND s.created_at < ${previousEnd}
            AND s.finished_at IS NOT NULL
            ${agentFilter}
        `),
      ])

      const calcVariation = (current: number, previous: number) => {
        if (previous === 0) {
          return current > 0 ? 100 : 0
        }

        return Number((((current - previous) / previous) * 100).toFixed(2))
      }

      const currentAverageResolutionMinutes = Number(
        currentAvgTimeRows[0]?.avg_minutes ?? 0
      )
      const previousAverageResolutionMinutes = Number(
        previousAvgTimeRows[0]?.avg_minutes ?? 0
      )

      return reply.status(200).send({
        period: { year, month },
        filter: { agentId },
        totals: {
          current: {
            totalServices: currentTotal,
            externalServices: currentExternal,
            averageResolutionMinutes: currentAverageResolutionMinutes,
          },
          previous: {
            totalServices: previousTotal,
            externalServices: previousExternal,
            averageResolutionMinutes: previousAverageResolutionMinutes,
          },
          variation: {
            totalServices: calcVariation(currentTotal, previousTotal),
            externalServices: calcVariation(currentExternal, previousExternal),
            averageResolutionMinutes: calcVariation(
              currentAverageResolutionMinutes,
              previousAverageResolutionMinutes
            ),
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
      const effectiveGroupBy = month === 'all' ? 'month' : groupBy
      const groupByFn = effectiveGroupBy === 'month' ? 'month' : 'day'

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
          date: dayjs(row.bucket).format(
            effectiveGroupBy === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'
          ),
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
          AND a.name <> 'Gerência de Tecnologia da Informação'
        GROUP BY a.id, a.name
        HAVING COUNT(s.id) > 0
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
    '/services/analytics/years',
    {
      schema: {
        tags: ['services'],
        summary: 'Lista anos com dados de atendimento',
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({
            years: z.array(z.number()),
          }),
        },
      },
    },
    async (request, reply) => {
      await request.getCurrentAgentId()

      const rows = await prisma.$queryRaw<Array<{ year: number }>>(Prisma.sql`
        SELECT DISTINCT EXTRACT(YEAR FROM s.created_at)::int AS year
        FROM services s
        ORDER BY year DESC
      `)

      return reply.status(200).send({
        years: rows.map(row => Number(row.year)),
      })
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
        WITH filtered_services AS (
          SELECT s.id
          FROM services s
          WHERE s.created_at >= ${start}
            AND s.created_at < ${end}
            ${agentFilter}
        ),
        primary_type_per_service AS (
          SELECT
            fs.id AS service_id,
            MIN(sst.service_type_id) AS service_type_id
          FROM filtered_services fs
          LEFT JOIN service_service_types sst ON sst.service_id = fs.id
          GROUP BY fs.id
        ),
        typed_counts AS (
          SELECT
            st.id AS service_type_id,
            st.name AS service_type_name,
            COUNT(pts.service_id)::int AS total_services
          FROM service_types st
          LEFT JOIN primary_type_per_service pts ON pts.service_type_id = st.id
          GROUP BY st.id, st.name
        ),
        untyped_count AS (
          SELECT COUNT(*)::int AS total_services
          FROM primary_type_per_service pts
          WHERE pts.service_type_id IS NULL
        )
        SELECT *
        FROM (
          SELECT
            tc.service_type_id,
            tc.service_type_name,
            tc.total_services
          FROM typed_counts tc

          UNION ALL

          SELECT
            'untyped'::text AS service_type_id,
            'Sem tipo'::text AS service_type_name,
            uc.total_services
          FROM untyped_count uc
        ) result
        WHERE result.total_services > 0
        ORDER BY result.total_services DESC, result.service_type_name ASC
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
