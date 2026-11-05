import { Bouncer } from '@adonisjs/bouncer'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import accessControl from '@kevinjohn/adonisjs-access-control/services/main'
import * as abilities from '#abilities/main'
import { policies } from '#policies/main'

/** Builds the per-request Bouncer from the authenticated user and the scope membership. */
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
