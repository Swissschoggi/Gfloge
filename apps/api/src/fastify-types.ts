declare module 'fastify' {
  interface FastifyInstance {
    db: import('@gfloge/db').Db
    config: import('@gfloge/shared/config').AppConfig
    providers: import('./providers/registry.js').ProviderRegistry
  }

  interface FastifyRequest {
    user?: import('@gfloge/shared').AuthedUser
    /** Row id of the current session, for logout revocation. */
    sessionRowId?: string
  }
}

export {}
