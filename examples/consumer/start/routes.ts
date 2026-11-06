import app from '@adonisjs/core/services/app'
import router from '@adonisjs/core/services/router'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { createManagedGuard, managedAccountMiddleware } from '@kevinjohn/adonisjs-account-kit/http'
import accessControl from '#config/access_control'
import { middleware } from '#start/kernel'
import User from '#models/user'

router.get('/', async () => {
  return { status: 'ok' }
})

/**
 * Account Kit's route protection runs before `scope`: it authenticates through the session guard
 * and refuses a session whose credential revision is stale, so a password change or sign-out
 * everywhere ends access at once. It leaves `ctx.auth.user` set, which is all the scope middleware
 * and the Bouncer initializer need; `middleware.auth()` alone would skip the revision check.
 * Pass `active: true` to also require an active, verified account, or use the kit's
 * `admissionMiddleware` when admission is enabled.
 */
const kitAccount = managedAccountMiddleware({
  kit: () => app.container.make(AccountKit),
  guard: createManagedGuard({
    strategy: 'session',
    name: 'web',
    loadUser: async () => User,
  }),
  active: false,
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
  .use([kitAccount, middleware.scope()])
