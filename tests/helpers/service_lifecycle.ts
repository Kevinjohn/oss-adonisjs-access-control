// Each invocation is a fresh ESM graph; failed modules cannot be re-evaluated in that graph.
import { rejects, strictEqual } from 'node:assert/strict'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { type AccessControl, defineAccessControl } from '../../index.ts'

const mode = process.argv[2]
const load = () => import('../../services/main.js')
const diagnostic = {
  name: 'RuntimeException',
  message: /services\/main requires an AdonisJS application/,
}
if (mode === 'pre-app') await rejects(load, diagnostic)

const config = defineAccessControl({
  roles: ['viewer'],
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  permissions: { members: { list: 'viewer', manage: 'viewer' }, invitations: { manage: 'viewer' } },
})
const ignitor = new IgnitorFactory()
  .withCoreProviders()
  .withCoreConfig()
  .create(new URL('../../', import.meta.url))
const app = ignitor.createApp('console')
try {
  await app.init()
  app.container.bindValue('access_control.manager', config as unknown as AccessControl)
  if (mode === 'pre-boot') {
    const service = await load()
    await app.boot()
    strictEqual(service.default, config)
  } else {
    await app.boot()
    await rejects(load, diagnostic)
  }
} finally {
  await ignitor.terminate()
}
