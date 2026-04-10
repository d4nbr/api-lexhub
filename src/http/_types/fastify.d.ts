import 'fastify'

declare module 'fastify' {
  export interface FastifyRequest {
    getCurrentAgentId(): Promise<string>
    getCurrentAgent(): Promise<{
      id: string
      role: 'ADMIN' | 'MEMBER' | 'SUBSECTION'
      canAccessDashboard: boolean
      canAccessServices: boolean
      canAccessFinancial: boolean
      subsecaoScope: string | null
    }>
    checkIfAgentIsAdmin(): Promise<void>
    checkModuleAccess(
      module: 'dashboard' | 'services' | 'financial' | 'agents'
    ): Promise<void>
  }
}
