import dayjs from 'dayjs'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import { z } from 'zod'

export async function getAllQuantityServicesByAgent(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/services/general/agent/:id',
      {
        schema: {
          tags: ['services'],
          summary: 'Busca todos os atendimentos cadastrados de um funcionário',
          security: [{ bearerAuth: [] }],
          params: z.object({
            id: z.string().uuid(),
          }),
          response: {
            200: z.object({
              totalGeneral: z.number(),
              totalOnMonth: z.number(),
              totalOnPreviousMonth: z.number(),
            }),
          },
        },
      },
      async (request, reply) => {
        await request.checkModuleAccess('services')

        await request.getCurrentAgentId()

        const { id } = request.params

        // Obtém o total geral de atendimentos do funcionário
        const servicesByAgent = await prisma.services.count({
          where: {
            agentId: id,
          },
        })

        // Obtém a data atual
        const now = dayjs()

        // Obtém o primeiro dia do mês atual
        const startOfMonth = now.startOf('month').toDate()

        // Obtém o último dia do mês atual
        const endOfMonth = now.endOf('month').toDate()

        // Obtém o total de atendimentos no mês do funcionário
        const servicesInMonth = await prisma.services.count({
          where: {
            agentId: id,
            createdAt: {
              gte: startOfMonth,
              lte: endOfMonth,
            },
          },
        })

        const startOfPreviousMonth = now
          .subtract(1, 'month')
          .startOf('month')
          .toDate()
        const endOfPreviousMonth = now
          .subtract(1, 'month')
          .endOf('month')
          .toDate()

        // Obtém o total de atendimentos no mês anterior do funcionário
        const servicesInPreviousMonth = await prisma.services.count({
          where: {
            agentId: id,
            createdAt: {
              gte: startOfPreviousMonth,
              lte: endOfPreviousMonth,
            },
          },
        })

        return reply.status(200).send({
          totalGeneral: servicesByAgent,
          totalOnMonth: servicesInMonth,
          totalOnPreviousMonth: servicesInPreviousMonth,
        })
      }
    )
}
