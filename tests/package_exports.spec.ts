import { rejects } from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { IgnitorFactory } from '@adonisjs/core/factories'

if (process.env.TEST_BUILT_EXPORTS === '1') {
  test('loads every built public export', async ({ assert }) => {
    const root = await import('@kevinjohn/adonisjs-access-control')
    const types = await import('@kevinjohn/adonisjs-access-control/types')
    const provider = await import('@kevinjohn/adonisjs-access-control/access_control_provider')
    const middleware = await import('@kevinjohn/adonisjs-access-control/middleware')
    const middlewareAlias = await import('@kevinjohn/adonisjs-access-control/scope_middleware')
    const accountKit = await import('@kevinjohn/adonisjs-access-control/account-kit')
    const commands = await import('@kevinjohn/adonisjs-access-control/commands')
    assert.isFunction(root.configure)
    assert.isFunction(root.defineAccessControl)
    assert.strictEqual(root.defineConfig, root.defineAccessControl)
    assert.strictEqual(middlewareAlias.default, middleware.default)
    assert.strictEqual(middlewareAlias.scopeMiddleware, middleware.scopeMiddleware)
    assert.isFunction(root.AccessControl)
    assert.isFunction(root.AccessControlError)
    assert.equal(root.errors.AccessControlError, root.AccessControlError)
    assert.deepEqual(Object.keys(root.errors).sort(), ['AccessControlError', 'errorTable'])
    assert.isString(root.stubsRoot)
    assert.isTrue(existsSync(root.stubsRoot))
    assert.isTrue(existsSync(join(root.stubsRoot, 'main.js')))
    assert.isTrue(existsSync(join(root.stubsRoot, 'migrations', 'released.json')))
    assert.lengthOf(Object.keys(types), 0)
    assert.isFunction(provider.default)
    assert.isFunction(commands.getMetaData)
    assert.isFunction(commands.getCommand)
    const metadata = await commands.getMetaData()
    assert.deepEqual(
      metadata.map((command) => command.commandName),
      ['access-control:doctor']
    )
    for (const subpath of [middleware, accountKit]) assert.equal(typeof subpath, 'object')

    const ignitor = new IgnitorFactory()
      .withCoreProviders()
      .withCoreConfig()
      .create(new URL('../', import.meta.url))
    const app = ignitor.createApp('console')
    try {
      await app.init()
      const config = root.defineConfig({
        roles: ['viewer'],
        users: { table: 'users', keyType: 'integer' },
        scope: { table: 'teams', keyType: 'integer' },
        permissions: {
          members: { list: 'viewer', manage: 'viewer' },
          invitations: { manage: 'viewer' },
        },
      })
      app.container.bindValue(
        root.AccessControl,
        config as unknown as InstanceType<typeof root.AccessControl>
      )
      await app.boot()
      const services = await import('@kevinjohn/adonisjs-access-control/services/main')
      assert.strictEqual(services.default, config)
    } finally {
      await ignitor.terminate()
    }
  })

  test('refuses deep imports of implementation modules', async () => {
    for (const path of [
      '@kevinjohn/adonisjs-access-control/providers/access_control_provider',
      '@kevinjohn/adonisjs-access-control/src/types',
      '@kevinjohn/adonisjs-access-control/build/index.js',
    ]) {
      await rejects(() => import(path), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
    }
  })
}
