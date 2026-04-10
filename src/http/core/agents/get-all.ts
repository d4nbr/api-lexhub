import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { BadRequestError } from 'http/_errors/bad-request-error'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import z from 'zod'

export async function getAll(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/agents/all',
      {
        schema: {
          tags: ['agents'],
          summary: 'Busca todos os funcionários cadastrados',
          security: [{ bearerAuth: [] }],
          querystring: z.object({
            pageIndex: z.coerce.number().default(1),
            name: z.string().optional(),
            role: z.enum(['ADMIN', 'MEMBER', 'SUBSECTION']).optional(),
          }),
          response: {
            200: z.object({
              agents: z.array(
                z.object({
                  id: z.string().uuid(),
                  name: z.string(),
                  email: z.string().email(),
                  role: z.enum(['ADMIN', 'MEMBER', 'SUBSECTION']),
                  canAccessDashboard: z.boolean(),
                  canAccessServices: z.boolean(),
                  canAccessFinancial: z.boolean(),
                  subsecaoScope: z.string().nullable(),
                  inactive: z.date().nullable(),
                })
              ),
              total: z.number(),
            }),
          },
        },
      },
      async (request, reply) => {
        // Somente administradores podem listar todos os funcionários
        await request.checkIfAgentIsAdmin()

        const { pageIndex, name, role } = request.query

        try {
          const [agents, total] = await Promise.all([
            prisma.agent.findMany({
              where: {
                name: name
                  ? { contains: name, mode: 'insensitive' }
                  : undefined,
                role: role ? role : undefined,
              },
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                canAccessDashboard: true,
                canAccessServices: true,
                canAccessFinancial: true,
                subsecaoScope: true,
                inactive: true,
              },
              orderBy: {
                createdAt: 'desc',
              },
              skip: (pageIndex - 1) * 10,
              take: 10,
            }),
            prisma.agent.count({
              where: {
                name: name
                  ? { contains: name, mode: 'insensitive' }
                  : undefined,
                role: role ? role : undefined,
              },
            }),
          ])

          if (!agents) {
            throw new BadRequestError(
              'Nenhum funcionário cadastrado. Cadastre um para continuar.'
            )
          }

          return reply.status(200).send({
            agents,
            total,
          })
        } catch (err) {
          throw new BadRequestError(
            'Não foi possível recuperar os atendimentos. Tente novamente mais tarde.'
          )
        }

        // const agents = await prisma.agent.findMany({
        //   select: {
        //     id: true,
        //     name: true,
        //     email: true,
        //     role: true,
        //     inactive: true,
        //   },
        //   orderBy: [
        //     {
        //       createdAt: 'desc', // Mostra os funcionários mais recentes primeiro
        //     },
        //   ],
        // })

        // if (!agents) {
        //   throw new BadRequestError(
        //     ' Ainda não há funcionários cadastrados no sistema. Por favor, cadastre um funcionário antes de prosseguir.'
        //   )
        // }

        // return reply.status(200).send({
        //   agents,
        //   total: agents.length,
        // })
      }
    )
}
