import { hash } from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { env } from 'http/_env'
import { BadRequestError } from 'http/_errors/bad-request-error'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import { resend } from 'lib/resend'
import { AgentRegistrationEmail } from 'utils/emails/agent-registration-email'
import { z } from 'zod'

const roleSchema = z.enum(['ADMIN', 'MEMBER', 'SUBSECTION'])

export async function createAccountService(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/agents',
      {
        schema: {
          tags: ['agents'],
          summary: 'Criação de um novo funcionário',
          security: [{ bearerAuth: [] }],
          body: z.object({
            name: z.string(),
            email: z.string().email(),
            password: z.string().min(8),
            role: roleSchema.default('MEMBER'),
            canAccessDashboard: z.boolean().optional(),
            canAccessServices: z.boolean().optional(),
            canAccessFinancial: z.boolean().optional(),
            subsecaoScope: z.string().trim().optional().nullable(),
          }),
          response: {
            201: z.null(),
          },
        },
      },
      async (request, reply) => {
        await request.checkIfAgentIsAdmin()

        const {
          name,
          email,
          password,
          role,
          canAccessDashboard,
          canAccessServices,
          canAccessFinancial,
          subsecaoScope,
        } = request.body

        const userWithSameEmail = await prisma.agent.findUnique({
          where: {
            email,
          },
        })

        if (userWithSameEmail) {
          throw new BadRequestError(
            'E-mail já cadastrado para outro funcionário.'
          )
        }

        const normalizedScope = subsecaoScope?.trim().toUpperCase() || null

        if (role === 'SUBSECTION' && !normalizedScope) {
          throw new BadRequestError(
            'Para o perfil Subseção, selecione a seccional/subseção vinculada.'
          )
        }

        const passwordHash = await hash(password, 8)

        const resolvedPermissions =
          role === 'ADMIN'
            ? {
                canAccessDashboard: true,
                canAccessServices: true,
                canAccessFinancial: true,
              }
            : {
                canAccessDashboard: canAccessDashboard ?? false,
                canAccessServices: canAccessServices ?? false,
                canAccessFinancial: canAccessFinancial ?? false,
              }

        try {
          await resend.emails.send({
            from: '📧 OAB Atende <oabatende@oabma.com.br>',
            to: email,
            subject: '🎉 Bem-vindo à equipe! Aqui estão suas informações.',
            react: AgentRegistrationEmail({
              name,
              email,
              tempPassword: password,
              link: env.WEB_URL,
            }),
          })

          await prisma.agent.create({
            data: {
              name,
              email,
              passwordHash,
              role,
              ...resolvedPermissions,
              subsecaoScope: role === 'SUBSECTION' ? normalizedScope : null,
            },
          })

          return reply.status(201).send()
        } catch {
          throw new BadRequestError(
            'Erro ao criar funcionário. Por favor, tente novamente.'
          )
        }
      }
    )
}
