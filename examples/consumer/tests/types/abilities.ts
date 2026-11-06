// Type-level check of the Bouncer wiring in app/middleware/initialize_bouncer_middleware.ts;
// never run. `pnpm typecheck` fails if the abilities lose their key union.
import type { HttpContext } from '@adonisjs/core/http'

export async function typed(ctx: HttpContext) {
  await ctx.bouncer.allows('project:write')
  await ctx.bouncer.allows('viewDashboard')
  // @ts-expect-error unknown permission key
  await ctx.bouncer.allows('project:typo')
}
