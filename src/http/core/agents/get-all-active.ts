import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import z from 'zod'

export async function getAllActive(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/agents/all-active',
      {
        schema: {
          tags: ['agents'],
          summary: 'Busca todos os funcionários ativos',
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({
              agents: z.array(
                z.object({
                  id: z.string().uuid(),
                  name: z.string(),
                })
              ),
            }),
          },
        },
      },
      async (request, reply) => {
        await request.getCurrentAgentId()

        const agents = await prisma.agent.findMany({
          where: {
            inactive: null,
            name: {
              not: 'Gerência de Tecnologia da Informação',
            },
            services: {
              some: {},
            },
          },
          select: {
            id: true,
            name: true,
          },
          orderBy: {
            name: 'asc',
          },
        })

        return reply.status(200).send({ agents })
      }
    )
}
