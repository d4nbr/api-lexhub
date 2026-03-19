import { Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { BadRequestError } from 'http/_errors/bad-request-error'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import z from 'zod'

export async function getServicesByMonthForChart(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/services/monthly',
      {
        schema: {
          tags: ['services'],
          summary: 'Busca a quantidade de atendimentos por mês',
          security: [{ bearerAuth: [] }],
          querystring: z
            .object({
              year: z.coerce.number().int().min(2000).max(2100),
            })
            .optional(),
          response: {
            200: z.array(
              z.object({
                data: z.string(),
                services: z.number(),
              })
            ),
          },
        },
      },
      async (request, reply) => {
        await request.getCurrentAgentId()

        try {
          const selectedYear = request.query?.year ?? dayjs().year()
          const startDate = dayjs(`${selectedYear}-01-01`).startOf('year').toDate()
          const endDate = dayjs(startDate).add(1, 'year').toDate()

          const rows = await prisma.$queryRaw<
            Array<{ month: Date; total_services: number }>
          >(Prisma.sql`
            SELECT
              DATE_TRUNC('month', s.created_at) AS month,
              COUNT(*)::int AS total_services
            FROM services s
            WHERE s.created_at >= ${startDate}
              AND s.created_at < ${endDate}
            GROUP BY month
            ORDER BY month ASC
          `)

          const monthMap = new Map(
            rows.map(row => [dayjs(row.month).month(), Number(row.total_services)])
          )

          const months = [
            'Jan',
            'Fev',
            'Mar',
            'Abr',
            'Mai',
            'Jun',
            'Jul',
            'Ago',
            'Set',
            'Out',
            'Nov',
            'Dez',
          ]

          const formattedData = months.map((label, monthIndex) => ({
            data: label,
            services: monthMap.get(monthIndex) ?? 0,
          }))

          return reply.status(200).send(formattedData)
        } catch {
          throw new BadRequestError(
            'Ocorreu um erro ao tentar recuperar os atendimentos mensais. Por favor, tente novamente mais tarde.'
          )
        }
      }
    )
}
