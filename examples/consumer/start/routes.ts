import router from '@adonisjs/core/services/router'

router.get('/', async () => {
  return { status: 'ok' }
})
