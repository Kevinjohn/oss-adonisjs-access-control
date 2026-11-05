// The scope middleware (specification section 7): resolves the request's membership.
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { AccessControl } from '../src/define.js'
import { AccessControlError } from '../src/errors.js'
import type { Membership } from '../src/types.js'

/** Options accepted by the named middleware and by `scopeMiddleware()`. */
export interface ScopeMiddlewareOptions {
  /** Where the scope key comes from. Default: `(ctx) => ctx.params.scopeId`. */
  resolveScope?: (ctx: HttpContext) => unknown
}

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    /** The active membership of `ctx.auth.user` in the route's scope, set by the scope middleware. */
    membership?: Membership | null
  }
}

/** The authenticated user as the auth or Account Kit middleware left it, without depending on their types. */
function userOf(ctx: HttpContext): { id: unknown } | null {
  const user = (ctx as { auth?: { user?: { id?: unknown } | null } }).auth?.user
  return user && user.id !== undefined && user.id !== null ? { id: user.id } : null
}

/**
 * Runs after the authentication middleware. No user, a malformed scope key, no membership, a
 * suspended membership or a stored role outside the configured tuple all refuse with
 * `E_ACCESS_CONTROL_FORBIDDEN`; otherwise `ctx.membership` is set. Nothing is cached.
 */
export default class ScopeMiddleware {
  /** Resolves the membership for `ctx.auth.user` in the route's scope or refuses with 403. */
  async handle(ctx: HttpContext, next: NextFn, options: ScopeMiddlewareOptions = {}) {
    const access = await ctx.containerResolver.make(AccessControl)
    const user = userOf(ctx)
    if (!user) throw new AccessControlError('E_ACCESS_CONTROL_FORBIDDEN')
    const scopeId = options.resolveScope ? options.resolveScope(ctx) : ctx.params?.scopeId
    let membership: Membership | null
    try {
      membership = await access.memberships.find(scopeId as never, user.id as never)
    } catch (error) {
      if (error instanceof AccessControlError && error.code === 'E_ACCESS_CONTROL_INVALID_INPUT')
        throw new AccessControlError('E_ACCESS_CONTROL_FORBIDDEN', { cause: error })
      throw error
    }
    if (!membership || membership.status !== 'active' || access.rank(membership.role) < 0)
      throw new AccessControlError('E_ACCESS_CONTROL_FORBIDDEN')
    ctx.membership = membership
    return next()
  }
}

/** The same behaviour as the named middleware, for `router.use(scopeMiddleware(options))`. */
export function scopeMiddleware(
  options: ScopeMiddlewareOptions = {}
): (ctx: HttpContext, next: NextFn) => Promise<unknown> {
  const middleware = new ScopeMiddleware()
  return (ctx, next) => middleware.handle(ctx, next, options)
}
