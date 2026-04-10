import type { FastifyInstance } from 'fastify'
import { fastifyPlugin } from 'fastify-plugin'
import { UnauthorizedError } from 'http/_errors/unauthorized-error'
import { prisma } from 'lib/prisma'

type ModuleAccess = 'dashboard' | 'services' | 'financial' | 'agents'

interface AgentAuthContext {
  id: string
  role: 'ADMIN' | 'MEMBER' | 'SUBSECTION'
  canAccessDashboard: boolean
  canAccessServices: boolean
  canAccessFinancial: boolean
  subsecaoScope: string | null
}

export const auth = fastifyPlugin(async (app: FastifyInstance) => {
  app.addHook('preHandler', async request => {
    const loadAgentContext = async (): Promise<AgentAuthContext> => {
      const { sub } = await request.jwtVerify<{ sub: string }>().catch(() => {
        throw new UnauthorizedError(
          'Token inválido ou expirado. Verifique as informações e tente novamente.'
        )
      })

      const agent = await prisma.agent.findUnique({
        where: { id: sub },
        select: {
          id: true,
          role: true,
          canAccessDashboard: true,
          canAccessServices: true,
          canAccessFinancial: true,
          subsecaoScope: true,
          inactive: true,
        },
      })

      if (!agent || agent.inactive) {
        throw new UnauthorizedError(
          'Funcionário não encontrado ou inativo. Verifique os dados e tente novamente.'
        )
      }

      return {
        id: agent.id,
        role: agent.role,
        canAccessDashboard: agent.role === 'ADMIN' ? true : agent.canAccessDashboard,
        canAccessServices: agent.role === 'ADMIN' ? true : agent.canAccessServices,
        canAccessFinancial: agent.role === 'ADMIN' ? true : agent.canAccessFinancial,
        subsecaoScope: agent.role === 'SUBSECTION' ? agent.subsecaoScope : null,
      }
    }

    request.getCurrentAgentId = async () => {
      const agent = await loadAgentContext()
      return agent.id
    }

    request.getCurrentAgent = async () => loadAgentContext()

    request.checkIfAgentIsAdmin = async () => {
      const agent = await loadAgentContext()

      if (agent.role !== 'ADMIN') {
        throw new UnauthorizedError(
          'Permissão negada. Você precisa ser um administrador para realizar esta ação.'
        )
      }
    }

    request.checkModuleAccess = async (module: ModuleAccess) => {
      const agent = await loadAgentContext()

      if (agent.role === 'ADMIN') return

      if (module === 'agents') {
        throw new UnauthorizedError('Permissão negada para gestão de usuários.')
      }

      if (module === 'dashboard' && !agent.canAccessDashboard) {
        throw new UnauthorizedError('Permissão negada para o módulo Dashboard.')
      }

      if (module === 'services' && !agent.canAccessServices) {
        throw new UnauthorizedError('Permissão negada para o módulo Atendimentos.')
      }

      if (module === 'financial' && !agent.canAccessFinancial) {
        throw new UnauthorizedError('Permissão negada para o módulo Financeiro.')
      }
    }
  })
})
