import * as abilities from '#abilities/main'
import { policies } from '#generated/policies'
import accessControl from '#config/access_control'

import { Bouncer } from '@adonisjs/bouncer'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Init bouncer middleware is used to create a bouncer instance
 * during an HTTP request
 */
export default class InitializeBouncerMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    /**
     * Create bouncer instance for the ongoing HTTP request. Access Control's abilities read the
     * membership the `scope` middleware sets, when they run.
     */
    ctx.bouncer = new Bouncer(
      () => ctx.auth.user || null,
      { ...abilities, ...accessControl.abilities(() => ctx.membership) },
      policies
    ).setContainerResolver(ctx.containerResolver)

    /**
     * Share bouncer helpers with Edge templates.
     */
    if ('view' in ctx) {
      ctx.view.share(ctx.bouncer.edgeHelpers)
    }

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
