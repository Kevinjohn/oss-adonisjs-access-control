import { rejects } from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@japa/runner'

if (process.env.TEST_BUILT_EXPORTS === '1') {
  test('loads every built public export', async ({ assert }) => {
    const root = await import('@kevinjohn/adonisjs-access-control')
    const types = await import('@kevinjohn/adonisjs-access-control/types')
    const provider = await import('@kevinjohn/adonisjs-access-control/access_control_provider')
    const services = await import('@kevinjohn/adonisjs-access-control/services/main')
    const middleware = await import('@kevinjohn/adonisjs-access-control/middleware')
    const accountKit = await import('@kevinjohn/adonisjs-access-control/account-kit')
    const commands = await import('@kevinjohn/adonisjs-access-control/commands')
    assert.isFunction(root.configure)
    assert.isFunction(root.defineAccessControl)
    assert.isFunction(root.AccessControl)
    assert.isFunction(root.AccessControlError)
    assert.equal(root.errors.AccessControlError, root.AccessControlError)
    assert.deepEqual(Object.keys(root.errors).sort(), ['AccessControlError', 'errorTable'])
    assert.isString(root.stubsRoot)
    assert.isTrue(existsSync(root.stubsRoot))
    assert.isTrue(existsSync(join(root.stubsRoot, 'main.js')))
    assert.lengthOf(Object.keys(types), 0)
    assert.isFunction(provider.default)
    assert.isFunction(commands.getMetaData)
    assert.isFunction(commands.getCommand)
    assert.deepEqual(await commands.getMetaData(), [])
    for (const subpath of [services, middleware, accountKit]) assert.equal(typeof subpath, 'object')
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
