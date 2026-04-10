import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { UnauthorizedError } from 'http/_errors/unauthorized-error'
import { auth } from 'http/middlewares/auth'
import { API_PROTHEUS_DATA_URL } from 'lib/axios'
import { prisma } from 'lib/prisma'
import { z } from 'zod'

interface LawyersProps {
  lawyer: {
    nome: string
    registro: string
    email: string
  }
}

export async function createService(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/services',
      {
        schema: {
          tags: ['services'],
          summary: 'Criação de um novo atendimento',
          security: [{ bearerAuth: [] }],
          body: z.object({
            oab: z.string(),
            serviceTypeId: z.array(z.string().cuid()),
            observation: z.string().optional(),
            assistance: z.enum(['PERSONALLY', 'REMOTE']),
            status: z.enum(['OPEN', 'COMPLETED']).default('OPEN'),
          }),
          response: {
            201: z.null(),
          },
        },
      },
      async (request, reply) => {
        await request.checkModuleAccess('services')

        const agentId = await request.getCurrentAgentId()

        const { oab, serviceTypeId, observation, assistance } = request.body

        // Verifica se o advogado já está cadastrado no banco de dados
        let lawyer = await prisma.lawyer.findUnique({
          where: {
            oab,
          },
        })

        // Cria o advogado no banco de dados se ele ainda não estiver cadastrado
        if (!lawyer) {
          const {
            data: { lawyer: lawyerData },
          } = await API_PROTHEUS_DATA_URL<LawyersProps>('/', {
            params: {
              idOrg: 10,
              param: oab,
            },
          })

          lawyer = await prisma.lawyer.create({
            data: {
              name: lawyerData.nome,
              oab: lawyerData.registro,
              email: lawyerData.email,
            },
          })
        }

        // Verifica se todos os tipos de serviço existem
        const serviceTypes = await Promise.all(
          serviceTypeId.map(async serviceType => {
            const type = await prisma.serviceTypes.findUnique({
              where: {
                id: serviceType,
              },
            })

            if (!type) {
              throw new UnauthorizedError(
                'Tipo de serviço não encontrado. Verifique as informações e tente novamente.'
              )
            }

            return type
          })
        )

        // Cria o atendimento (Service)
        const service = await prisma.services.create({
          data: {
            assistance,
            observation,
            agentId,
            lawyerId: lawyer.id,
          },
        })

        // Associa o Service aos ServiceTypes na tabela ServiceServiceTypes
        await Promise.all(
          serviceTypes.map(async serviceType => {
            await prisma.serviceServiceTypes.create({
              data: {
                serviceId: service.id,
                serviceTypeId: serviceType.id,
              },
            })
          })
        )

        return reply.status(201).send()
      }
    )
}
