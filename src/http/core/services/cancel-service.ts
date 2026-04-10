import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { UnauthorizedError } from 'http/_errors/unauthorized-error'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import z from 'zod'

export async function cancelService(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .delete(
      '/services/cancel/:id',
      {
        schema: {
          tags: ['services'],
          summary: 'Cancelar um atendimento enquanto em aberto',
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
            'O serviço solicitado não foi localizado em nossa base de dados. Por favor, verifique as informações e tente novamente.'
          )
        }

        if (service.status !== 'OPEN') {
          throw new UnauthorizedError(
            'O serviço solicitado já foi finalizado. Por favor, verifique as informações e tente novamente.'
          )
        }

        try {
          await prisma.services.delete({
            where: { id },
          })

          return reply.status(204).send()
        } catch (err) {
          throw new UnauthorizedError(
            'Ocorreu um erro para cancelar o atendimento. Por favor, verifique os dados informados e tente novamente.'
          )
        }
      }
    )
}
