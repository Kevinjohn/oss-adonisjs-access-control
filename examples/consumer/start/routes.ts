import router from '@adonisjs/core/services/router'
import accessControl from '@kevinjohn/adonisjs-access-control/services/main'
import { middleware } from '#start/kernel'

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
