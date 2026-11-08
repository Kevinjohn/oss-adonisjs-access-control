// #region initialize_bouncer
import { Bouncer } from '@adonisjs/bouncer'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import accessControl from '#config/access_control'
import * as abilities from '#abilities/main'
import { policies } from '#policies/main'

/**
 * Builds the per-request Bouncer from the authenticated user and the scope membership. The
 * abilities come from `config/access_control.ts` so their key union is typed; the container
 * singleton from `services/main` is the same instance, typed only as `AccessControl`.
 */
export default class InitializeBouncerMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    ctx.bouncer = new Bouncer(
      () => ctx.auth.user || null,
      { ...abilities, ...accessControl.abilities(() => ctx.membership) },
      policies
    ).setContainerResolver(ctx.containerResolver)
    return next()
  }
}

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    bouncer: Bouncer<
      Exclude<HttpContext['auth']['user'], undefined>,
      typeof abilities & ReturnType<typeof accessControl.abilities>,
      typeof policies
    >
  }
}
// #endregion initialize_bouncer
