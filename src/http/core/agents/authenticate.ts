import { compare } from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { env } from 'http/_env'
import { BadRequestError } from 'http/_errors/bad-request-error'
import { prisma } from 'lib/prisma'
import { z } from 'zod'

export async function authenticate(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/agents/sessions',
    {
      schema: {
        tags: ['agents'],
        summary: 'Autenticação de um funcionário',
        body: z.object({
          email: z.string().email(),
          password: z.string().min(8),
        }),
        response: {
          201: z.object({
            token: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body

      const userFromEmail = await prisma.agent.findUnique({
        where: {
          email,
        },
      })

      // Verifica se o usuário foi desativado pelo administrador
      if (userFromEmail && userFromEmail.inactive !== null) {
        throw new BadRequestError(
          'O funcionário está inativo. Procure com o administrador do sistema.'
        )
      }

      if (!userFromEmail) {
        throw new BadRequestError(
          'Credenciais inválidas. Verifique suas informações e tente novamente.'
        )
      }

      const isPasswordValid = await compare(
        password,
        userFromEmail.passwordHash
      )

      if (!isPasswordValid) {
        throw new BadRequestError(
          'Credenciais inválidas. Verifique suas informações e tente novamente.'
        )
      }

      // Criação do token de autenticação
      const token = await reply.jwtSign(
        {
          sub: userFromEmail.id,
          role: userFromEmail.role,
          canAccessDashboard:
            userFromEmail.role === 'ADMIN'
              ? true
              : userFromEmail.canAccessDashboard,
          canAccessServices:
            userFromEmail.role === 'ADMIN'
              ? true
              : userFromEmail.canAccessServices,
          canAccessFinancial:
            userFromEmail.role === 'ADMIN'
              ? true
              : userFromEmail.canAccessFinancial,
          subsecaoScope:
            userFromEmail.role === 'SUBSECTION'
              ? userFromEmail.subsecaoScope
              : null,
        },
        {
          sign: {
            expiresIn: '1d', // 1 dia
          },
        }
      )

      const cookieDomain = env.COOKIE_DOMAIN?.trim()

      return reply
        .setCookie('@lexhub-auth', token, {
          path: '/',
          httpOnly: true,
          secure: env.NODE_ENV === 'production',
          sameSite: 'lax',
          ...(cookieDomain ? { domain: cookieDomain } : {}),
          maxAge: 60 * 60 * 24, // 1 dia
        })
        .status(201)
        .send({ token })
    }
  )
}
