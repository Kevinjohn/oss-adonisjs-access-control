import type { HttpContext } from '@adonisjs/core/http'

/** Options accepted by the named middleware and by `scopeMiddleware()`. */
export interface ScopeMiddlewareOptions {
  /** Where the scope key comes from. Default: `(ctx) => ctx.params.scopeId`. */
  resolveScope?: (ctx: HttpContext) => unknown
}
