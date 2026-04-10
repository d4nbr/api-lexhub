import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { BadRequestError } from 'http/_errors/bad-request-error'
import { auth } from 'http/middlewares/auth'
import { prisma } from 'lib/prisma'
import z from 'zod'

export async function getAllServices(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/services/all',
      {
        schema: {
          tags: ['services'],
          summary: 'Busca todos os atendimentos cadastrados',
          security: [{ bearerAuth: [] }],
          querystring: z.object({
            pageIndex: z.coerce.number().default(1),
            oab: z.string().optional(),
            lawyerName: z.string().optional(),
            agentName: z.string().optional(),
            assistance: z.enum(['PERSONALLY', 'REMOTE']).optional(), // Filtro por tipo de assistance
            status: z.enum(['OPEN', 'COMPLETED']).optional(), // Filtro por status
          }),
          response: {
            200: z.object({
              services: z.array(
                z.object({
                  id: z.string().uuid(),
                  assistance: z.enum(['PERSONALLY', 'REMOTE']),
                  observation: z.string().nullable(),
                  status: z.enum(['OPEN', 'COMPLETED']),
                  createdAt: z.date(),
                  finishedAt: z.date().nullable(),
                  lawyer: z.object({
                    id: z.string().uuid(),
                    name: z.string(),
                    oab: z.string(),
                    email: z.string(),
                  }),
                  agent: z.object({
                    id: z.string().uuid(),
                    name: z.string(),
                    email: z.string(),
                    role: z.enum(['ADMIN', 'MEMBER', 'SUBSECTION']),
                  }),
                  serviceTypes: z.array(
                    z.object({
                      serviceType: z.object({
                        id: z.string().cuid(),
                        name: z.string(),
                      }),
                    })
                  ),
                })
              ),
              total: z.number(),
            }),
          },
        },
      },
      async (request, reply) => {
        await request.checkModuleAccess('services')

        await request.getCurrentAgentId()

        const { pageIndex, oab, lawyerName, agentName, assistance, status } =
          request.query

        try {
          const [services, total] = await Promise.all([
            prisma.services.findMany({
              where: {
                assistance: assistance ? assistance : undefined, // Filtro por assistance
                status: status ? status : undefined, // Filtro por status
                lawyer: {
                  oab: oab ? { contains: oab, mode: 'insensitive' } : undefined,
                  name: lawyerName
                    ? { contains: lawyerName, mode: 'insensitive' }
                    : undefined,
                },
                agent: {
                  name: agentName
                    ? { contains: agentName, mode: 'insensitive' }
                    : undefined,
                },
              },
              select: {
                id: true,
                assistance: true,
                observation: true,
                status: true,
                createdAt: true,
                finishedAt: true,
                lawyer: {
                  select: {
                    id: true,
                    name: true,
                    oab: true,
                    email: true,
                  },
                },
                agent: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                  },
                },
                serviceTypes: {
                  select: {
                    serviceType: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                  },
                },
              },
              orderBy: [
                { status: 'asc' }, // OPEN antes de COMPLETED
                { finishedAt: 'desc' }, // Mais recentes primeiro
                { createdAt: 'desc' }, // Mais recentes primeiro
              ],
              skip: (pageIndex - 1) * 10, // Pular os primeiros 10 atendimentos
              take: 10, // Recuperar apenas 10 atendimentos
            }),
            prisma.services.count({
              where: {
                assistance: assistance ? assistance : undefined, // Filtro por assistance
                status: status ? status : undefined, // Filtro por status
                lawyer: {
                  oab: oab ? { contains: oab, mode: 'insensitive' } : undefined,
                  name: lawyerName
                    ? { contains: lawyerName, mode: 'insensitive' }
                    : undefined,
                },
                agent: {
                  name: agentName
                    ? { contains: agentName, mode: 'insensitive' }
                    : undefined,
                },
              },
            }),
          ])

          if (!services) {
            throw new BadRequestError(
              ' Ainda não existem atendimentos cadastrados.'
            )
          }

          return reply.status(200).send({ services, total })
        } catch (err) {
          throw new BadRequestError(
            ' Ocorreu um erro ao tentar recuperar os atendimentos. Por favor, tente novamente mais tarde. Caso o problema persista, entre em contato com o suporte técnico para assistência.'
          )
        }
      }
    )
}
