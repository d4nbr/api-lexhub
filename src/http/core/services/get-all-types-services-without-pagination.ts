import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { BadRequestError } from 'http/_errors/bad-request-error'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import z from 'zod'

export async function getAllTypesServicesWithoutPagination(
  app: FastifyInstance
) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/services/types/all-wp',
      {
        schema: {
          tags: ['servicesTypes'],
          summary: 'Busca todos os tipos de serviços cadastrados sem paginação',
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({
              servicesTypes: z.array(
                z.object({
                  id: z.string().cuid(),
                  name: z.string(),
                })
              ),
            }),
          },
        },
      },
      async (request, reply) => {
        await request.checkModuleAccess('services')

        await request.getCurrentAgentId()

        const servicesTypes = await prisma.serviceTypes.findMany({
          select: {
            id: true,
            name: true,
          },
          orderBy: [
            {
              createdAt: 'asc', // Mostra os tipos de serviços por ordem de criação
            },
          ],
        })

        if (!servicesTypes) {
          throw new BadRequestError(
            'Nenhum tipo de serviço cadastrado. Cadastre um para continuar.'
          )
        }

        return reply.status(200).send({ servicesTypes })
      }
    )
}
