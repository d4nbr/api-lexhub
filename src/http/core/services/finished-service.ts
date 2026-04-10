import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { UnauthorizedError } from 'http/_errors/unauthorized-error'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import z from 'zod'

export async function finishedService(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .patch(
      '/services/finished/:id',
      {
        schema: {
          tags: ['services'],
          summary: 'Finalizar um atendimento',
          security: [{ bearerAuth: [] }],
          params: z.object({
            id: z.string().uuid(),
          }),
          response: {
            204: z.null(),
          },
        },
      },
      async (request, reply) => {
        await request.checkModuleAccess('services')

        await request.getCurrentAgentId()

        const { id } = request.params

        const service = await prisma.services.findUnique({
          where: { id },
        })

        if (!service) {
          throw new UnauthorizedError(
            'O atendimento não foi encontrado. Verifique os dados e tente novamente.'
          )
        }

        if (service.status === 'COMPLETED') {
          throw new UnauthorizedError(
            'O atendimento já foi finalizado. Verifique os dados e tente novamente.'
          )
        }

        try {
          await prisma.services.update({
            where: {
              id,
            },
            data: {
              finishedAt: new Date(),
              status: 'COMPLETED',
            },
          })

          return reply.status(204).send()
        } catch (err) {
          throw new UnauthorizedError(
            ' Ocorreu um erro ao finalizar o atendimento. Por favor, tente novamente mais tarde.'
          )
        }
      }
    )
}
