import app from '@adonisjs/core/services/app'
import router from '@adonisjs/core/services/router'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { createManagedGuard, managedAccountMiddleware } from '@kevinjohn/adonisjs-account-kit/http'
import accessControl from '@kevinjohn/adonisjs-access-control/services/main'
import { middleware } from '#start/kernel'
import User from '#models/user'

router.get('/', async () => {
  return { status: 'ok' }
})

router
  .group(() => {
    router.get('/teams/:scopeId/project', async ({ bouncer, membership }) => {
      return {
        membership: accessControl.clientPayload(membership),
        canWrite: await bouncer.allows('project:write'),
        canArchive: await bouncer.allows('project:archive'),
        canViewDashboard: await bouncer.allows('viewDashboard'),
      }
    })
    router.post('/teams/:scopeId/archive', async ({ bouncer }) => {
      await bouncer.authorize('project:archive')
      return { archived: true }
    })
  })
  .use([middleware.auth(), middleware.scope()])

/**
 * Account Kit's own route protection, without `middleware.auth()`: the kit middleware leaves
 * `ctx.auth.user` set, which is all the scope middleware and the Bouncer initializer need.
 */
const kitOnly = managedAccountMiddleware({
  kit: () => app.container.make(AccountKit),
  guard: createManagedGuard({
    strategy: 'session',
    name: 'web',
    loadUser: async () => User,
  }),
  active: false,
})

router
  .get('/teams/:scopeId/kit-only', async ({ bouncer, membership }) => {
    return {
      membership: accessControl.clientPayload(membership),
      canWrite: await bouncer.allows('project:write'),
    }
  })
  .use([kitOnly, middleware.scope()])
