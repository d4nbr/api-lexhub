import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { UnauthorizedError } from 'http/_errors/unauthorized-error'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import z from 'zod'

const roleSchema = z.enum(['ADMIN', 'MEMBER', 'SUBSECTION'])

export async function updateAgent(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .put(
      '/agents/update/:id',
      {
        schema: {
          tags: ['agents'],
          summary: 'Atualização de um funcionário',
          security: [{ bearerAuth: [] }],
          params: z.object({
            id: z.string().uuid(),
          }),
          body: z.object({
            name: z.string().optional(),
            email: z.string().email().optional(),
            role: roleSchema.optional(),
            canAccessDashboard: z.boolean().optional(),
            canAccessServices: z.boolean().optional(),
            canAccessFinancial: z.boolean().optional(),
            subsecaoScope: z.string().trim().optional().nullable(),
          }),
          response: {
            204: z.null(),
          },
        },
      },
      async (request, reply) => {
        await request.checkIfAgentIsAdmin()

        const { id } = request.params
        const {
          name,
          email,
          role,
          canAccessDashboard,
          canAccessServices,
          canAccessFinancial,
          subsecaoScope,
        } = request.body

        const agent = await prisma.agent.findUnique({
          where: { id },
        })

        if (!agent) {
          throw new UnauthorizedError(
            'Funcionário não encontrado. Verifique os dados e tente novamente.'
          )
        }

        if (email && email !== agent.email) {
          const emailExists = await prisma.agent.findUnique({
            where: { email },
          })

          if (emailExists) {
            throw new UnauthorizedError(
              'E-mail já cadastrado. Verifique as informações e tente novamente.'
            )
          }
        }

        const resolvedRole = role ?? agent.role
        const normalizedScope = subsecaoScope?.trim().toUpperCase() || null

        if (resolvedRole === 'SUBSECTION' && !normalizedScope) {
          throw new UnauthorizedError(
            'Para o perfil Subseção, selecione a seccional/subseção vinculada.'
          )
        }

        const resolvedPermissions =
          resolvedRole === 'ADMIN'
            ? {
                canAccessDashboard: true,
                canAccessServices: true,
                canAccessFinancial: true,
              }
            : {
                canAccessDashboard:
                  canAccessDashboard ?? agent.canAccessDashboard,
                canAccessServices: canAccessServices ?? agent.canAccessServices,
                canAccessFinancial:
                  canAccessFinancial ?? agent.canAccessFinancial,
              }

        try {
          await prisma.agent.update({
            where: {
              id,
            },
            data: {
              name,
              email,
              role,
              ...resolvedPermissions,
              subsecaoScope:
                resolvedRole === 'SUBSECTION' ? normalizedScope : null,
              updatedAt: new Date(),
            },
          })

          return reply.status(204).send()
        } catch {
          throw new UnauthorizedError(
            'Falha na atualização. Verifique os dados e tente novamente.'
          )
        }
      }
    )
}
