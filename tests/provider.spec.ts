import { test } from '@japa/runner'
import { AccessControl, defineAccessControl } from '../index.js'
import { bootTestApp } from './helpers/app.js'
import { codeOf } from './helpers/fixture.js'

test.group('provider and service (spec 1.7, 5)', () => {
  test('binds the configured AccessControl with the database attached, under its alias too', async ({
    assert,
  }) => {
    const booted = await bootTestApp()
    try {
      const access = await booted.app.container.make(AccessControl)
      assert.instanceOf(access, AccessControl)
      assert.strictEqual(await booted.app.container.make('access_control'), access)
      assert.strictEqual(booted.app.config.get('access_control'), access)
      const scope = await booted.db
        .table(booted.names.scope)
        .returning('id')
        .insert({ name: 'team' })
      const user = await booted.db
        .table(booted.names.users)
        .returning('id')
        .insert({ name: 'owner' })
      const scopeId = Number(typeof scope[0] === 'object' ? scope[0].id : scope[0])
      const userId = Number(typeof user[0] === 'object' ? user[0].id : user[0])
      const first = await access.memberships.createFirstMember({ scopeId, userId })
      assert.equal(first.role, 'owner')
      assert.deepInclude(await access.memberships.find(scopeId, userId), { role: 'owner' })
    } finally {
      await booted.close()
    }
  })

  test('services/main resolves the same instance after boot', async ({ assert }) => {
    const booted = await bootTestApp()
    try {
      const { default: service } = await import('../services/main.js')
      assert.strictEqual(service, await booted.app.container.make(AccessControl))
    } finally {
      await booted.close()
    }
  })

  test('boot fails early when the config is not a defineAccessControl result', async ({
    assert,
  }) => {
    assert.equal(
      await codeOf(bootTestApp({ accessControl: { roles: ['viewer'] } })),
      'E_ACCESS_CONTROL_INVALID_CONFIG'
    )
  })

  test('without the provider the config stays detached', async ({ assert }) => {
    const config = defineAccessControl({
      roles: ['viewer'],
      users: { table: 'users', keyType: 'integer' },
      scope: { table: 'teams', keyType: 'integer' },
      permissions: {
        members: { list: 'viewer', manage: 'viewer' },
        invitations: { manage: 'viewer' },
      },
    })
    const booted = await bootTestApp({ accessControl: config, withProvider: false })
    try {
      assert.throws(() => config.memberships, /attach/)
    } finally {
      await booted.close()
    }
  })

  test('boot is a no-op without a config file', async ({ assert }) => {
    const booted = await bootTestApp({ accessControl: undefined })
    try {
      assert.isUndefined(booted.app.config.get('access_control'))
      assert.equal(
        await codeOf(booted.app.container.make(AccessControl)),
        'E_ACCESS_CONTROL_INVALID_CONFIG'
      )
    } finally {
      await booted.close()
    }
  })
})
