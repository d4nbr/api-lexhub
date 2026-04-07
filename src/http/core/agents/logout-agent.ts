import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { env } from 'http/_env'
import { BadRequestError } from 'http/_errors/bad-request-error'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import z from 'zod'

export async function logoutAgent(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/agents/logout',
      {
        schema: {
          tags: ['agents'],
          summary: 'Desloga o funcionário logado',
          security: [{ bearerAuth: [] }],
          response: {
            200: z.null(),
          },
        },
      },
      async (request, reply) => {
        const agentId = await request.getCurrentAgentId()

        // Retorna o usuário somente com os dados necessários
        const agent = await prisma.agent.findUnique({
          where: {
            id: agentId,
          },
        })

        if (!agent) {
          throw new BadRequestError(
            ' O funcionário solicitado não foi localizado em nossa base de dados. Por favor, verifique os dados informados e tente novamente.'
          )
        }

        const cookieDomain = env.COOKIE_DOMAIN?.trim()

        return reply
          .clearCookie('@lexhub-auth', {
            path: '/',
            ...(cookieDomain ? { domain: cookieDomain } : {}),
          })
          .status(200)
          .send()
      }
    )
}
