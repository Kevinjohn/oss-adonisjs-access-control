import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/** Every response is JSON; the fixture has no views. */
export default class ForceJsonResponseMiddleware {
  handle({ request }: HttpContext, next: NextFn) {
    request.request.headers.accept = 'application/json'
    return next()
  }
}
