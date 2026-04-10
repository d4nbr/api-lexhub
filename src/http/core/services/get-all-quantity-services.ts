import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { BadRequestError } from 'http/_errors/bad-request-error'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import z from 'zod'

export async function getAllQuantityServices(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/services/general',
      {
        schema: {
          tags: ['services'],
          summary: 'Busca todos os atendimentos cadastrados geral',
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({
              total: z.number(),
            }),
          },
        },
      },
      async (request, reply) => {
        await request.checkModuleAccess('services')

        await request.getCurrentAgentId()

        const services = await prisma.services.count()

        return reply.status(200).send({ total: services })
      }
    )
}
