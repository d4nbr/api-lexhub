import dayjs from 'dayjs'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import { z } from 'zod'

export async function getAllQuantityServicesPerDay(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/services/general/agent/day',
      {
        schema: {
          tags: ['services'],
          summary: 'Busca todos os atendimentos cadastrados no dia',
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({
              totalTheDay: z.number(),
              totalLastDay: z.number(),
            }),
          },
        },
      },
      async (request, reply) => {
        await request.checkModuleAccess('services')

        await request.getCurrentAgentId()

        const now = dayjs()

        // Busca o intervalo do dia atual (00:00 até 23:59)
        const startOfDay = now.startOf('day').toDate()
        const endOfDay = now.endOf('day').toDate()

        // Busca o intervalo do dia anterior (00:00 até 23:59)
        const startOfLastDay = now.subtract(1, 'day').startOf('day').toDate()
        const endOfLastDay = now.subtract(1, 'day').endOf('day').toDate()

        const totalTheDay = await prisma.services.count({
          where: {
            createdAt: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
        })

        const totalLastDay = await prisma.services.count({
          where: {
            createdAt: {
              gte: startOfLastDay,
              lte: endOfLastDay,
            },
          },
        })

        return reply.status(200).send({
          totalTheDay,
          totalLastDay,
        })
      }
    )
}
