// The scope middleware (specification section 7): resolves the request's membership.
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import {
  E_ACCESS_CONTROL_FORBIDDEN,
  E_ACCESS_CONTROL_INVALID_INPUT,
  E_ACCESS_CONTROL_UNKNOWN_ROLE,
} from '../errors.ts'
import type { Membership } from '../types.ts'

import type { ScopeMiddlewareOptions } from '../scope_middleware_types.ts'

export type { ScopeMiddlewareOptions } from '../scope_middleware_types.ts'

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    /** The active membership of `ctx.auth.user` in the route's scope, set by the scope middleware. */
    membership?: Membership | null
  }
}

/** The authenticated user as the auth or Account Kit middleware left it, without depending on their types. */
function readAuthenticatedUser(ctx: HttpContext): { id: unknown } | null {
  const user = (ctx as { auth?: { user?: { id?: unknown } | null } }).auth?.user
  return user && user.id !== undefined && user.id !== null ? { id: user.id } : null
}

/**
 * Runs after the authentication middleware. No user, a malformed scope key, no membership, a
 * suspended membership or a stored role outside the configured tuple all refuse with
 * `E_ACCESS_CONTROL_FORBIDDEN`; otherwise `ctx.membership` is set. Nothing is cached.
 *
 * @example
 * ```ts
 * import ScopeMiddleware from '@kevinjohn/adonisjs-access-control/scope_middleware'
 * import router from '@adonisjs/core/services/router'
 *
 * export const middleware = router.named({
 *   scope: async () => ({ default: ScopeMiddleware }),
 * })
 * ```
 */
export default class ScopeMiddleware {
  /** Resolves the membership for `ctx.auth.user` in the route's scope or refuses with 403. */
  async handle(ctx: HttpContext, next: NextFn, options: ScopeMiddlewareOptions = {}) {
    const access = await ctx.containerResolver.make('access_control.manager')
    const user = readAuthenticatedUser(ctx)
    if (!user) throw new E_ACCESS_CONTROL_FORBIDDEN()
    const scopeId = options.resolveScope ? options.resolveScope(ctx) : ctx.params?.scopeId
    let membership: Membership | null
    try {
      membership = await access.memberships.findActive(scopeId as never, user.id as never)
    } catch (error) {
      if (
        error instanceof E_ACCESS_CONTROL_INVALID_INPUT ||
        error instanceof E_ACCESS_CONTROL_UNKNOWN_ROLE
      )
        throw new E_ACCESS_CONTROL_FORBIDDEN(undefined, { cause: error })
      throw error
    }
    if (!membership) throw new E_ACCESS_CONTROL_FORBIDDEN()
    ctx.membership = membership
    return next()
  }
}

/**
 * The same behaviour as the named middleware, for `router.use(scopeMiddleware(options))`.
 *
 * @example
 * ```ts
 * import { scopeMiddleware } from '@kevinjohn/adonisjs-access-control/scope_middleware'
 * import router from '@adonisjs/core/services/router'
 *
 * router
 *   .get('/teams/:scopeId/projects', async ({ membership }) => ({ role: membership?.role }))
 *   .use([authenticate, scopeMiddleware()])
 * ```
 */
export function scopeMiddleware(
  options: ScopeMiddlewareOptions = {}
): (ctx: HttpContext, next: NextFn) => Promise<unknown> {
  const middleware = new ScopeMiddleware()
  return (ctx, next) => middleware.handle(ctx, next, options)
}
