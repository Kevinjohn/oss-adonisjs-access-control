import { test } from '@japa/runner'
import { AccessControlError, defineAccessControl } from '../index.js'

const base = {
  roles: ['viewer', 'editor', 'admin', 'owner'],
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  permissions: {
    project: { read: 'viewer', write: 'editor', archive: 'admin' },
    members: { list: 'admin', manage: 'admin' },
    invitations: { manage: 'admin' },
  },
} as const

/** Builds a config from the valid base with one override; the override is typed loosely on purpose. */
function invalid(overrides: Record<string, unknown>) {
  return () => defineAccessControl({ ...base, ...overrides } as any)
}

function assertInvalidConfig(assert: any, build: () => unknown, detail: RegExp) {
  try {
    build()
  } catch (error) {
    assert.instanceOf(error, AccessControlError)
    assert.equal((error as AccessControlError).code, 'E_ACCESS_CONTROL_INVALID_CONFIG')
    assert.equal((error as AccessControlError).status, 500)
    assert.match((error as Error).message, detail)
    return
  }
  assert.fail('expected E_ACCESS_CONTROL_INVALID_CONFIG')
}

test.group('defineAccessControl: boot validation (spec 2.3)', () => {
  test('returns a frozen instance for a valid config', ({ assert }) => {
    const ac = defineAccessControl(base)
    assert.isTrue(Object.isFrozen(ac))
    assert.isTrue(Object.isFrozen(ac.config))
    assert.isTrue(Object.isFrozen(ac.config.permissions))
    assert.deepEqual([...ac.roles], ['viewer', 'editor', 'admin', 'owner'])
    assert.equal(ac.ownerRole, 'owner')
    assert.equal(ac.config.membershipsTable, 'memberships')
    assert.deepEqual(
      [...ac.permissionKeys],
      [
        'project:read',
        'project:write',
        'project:archive',
        'members:list',
        'members:manage',
        'invitations:manage',
      ]
    )
  })

  test('2.3.1 rejects empty roles', ({ assert }) => {
    assertInvalidConfig(assert, invalid({ roles: [] }), /roles/)
  })

  test('2.3.1 rejects duplicate roles', ({ assert }) => {
    assertInvalidConfig(
      assert,
      invalid({ roles: ['viewer', 'editor', 'viewer', 'owner'] }),
      /duplicate.*viewer/
    )
  })

  test('2.3.1 rejects a role name that fails the pattern or is too long', ({ assert }) => {
    assertInvalidConfig(assert, invalid({ roles: ['Viewer', 'owner'] }), /role name "Viewer"/)
    assertInvalidConfig(assert, invalid({ roles: ['view er', 'owner'] }), /role name "view er"/)
    assertInvalidConfig(assert, invalid({ roles: ['1st', 'owner'] }), /role name "1st"/)
    assertInvalidConfig(
      assert,
      invalid({ roles: ['a'.repeat(33), 'owner'] }),
      /role name "a{33}".*32 characters/
    )
    defineAccessControl({
      ...base,
      roles: ['view-er_2', 'owner'],
      permissions: {
        members: { list: 'view-er_2', manage: 'view-er_2' },
        invitations: { manage: 'view-er_2' },
      },
    } as any)
  })

  test('2.3.2 rejects a permission value outside roles', ({ assert }) => {
    assertInvalidConfig(
      assert,
      invalid({ permissions: { ...base.permissions, project: { read: 'guest' } } }),
      /project:read.*"guest"/
    )
  })

  test('2.3.3 rejects a resource or action name that fails the pattern', ({ assert }) => {
    assertInvalidConfig(
      assert,
      invalid({ permissions: { ...base.permissions, 'my-project': { read: 'viewer' } } }),
      /resource name "my-project"/
    )
    assertInvalidConfig(
      assert,
      invalid({ permissions: { ...base.permissions, project: { 'read:all': 'viewer' } } }),
      /action name "read:all"/
    )
    assertInvalidConfig(
      assert,
      invalid({ permissions: { ...base.permissions, Project: { read: 'viewer' } } }),
      /resource name "Project"/
    )
    defineAccessControl({
      ...base,
      permissions: { ...base.permissions, projectV2: { readAll9: 'viewer' } },
    } as any)
  })

  test('2.3.4 rejects a missing reserved key', ({ assert }) => {
    for (const [resource, action] of [
      ['members', 'list'],
      ['members', 'manage'],
      ['invitations', 'manage'],
    ] as const) {
      const permissions = structuredClone(base.permissions) as Record<
        string,
        Record<string, string>
      >
      delete permissions[resource][action]
      assertInvalidConfig(
        assert,
        invalid({ permissions }),
        new RegExp(`reserved key ${resource}:${action}`)
      )
    }
    const permissions = structuredClone(base.permissions) as Record<string, unknown>
    delete permissions.invitations
    assertInvalidConfig(assert, invalid({ permissions }), /reserved key invitations:manage/)
  })

  test('2.3.5 rejects an owner role that is not last or a single-role tuple', ({ assert }) => {
    assertInvalidConfig(assert, invalid({ ownerRole: 'admin' }), /ownerRole "admin".*last/)
    assertInvalidConfig(assert, invalid({ ownerRole: 'ceo' }), /ownerRole "ceo"/)
    assertInvalidConfig(
      assert,
      invalid({
        roles: ['owner'],
        permissions: {
          members: { list: 'owner', manage: 'owner' },
          invitations: { manage: 'owner' },
        },
      }),
      /ownerRole.*at least two roles/
    )
  })

  test('2.3.6 rejects table names that are not plain SQL identifiers', ({ assert }) => {
    assertInvalidConfig(
      assert,
      invalid({ users: { table: 'app.users', keyType: 'integer' } }),
      /users\.table "app\.users"/
    )
    assertInvalidConfig(
      assert,
      invalid({ scope: { table: 'teams;', keyType: 'integer' } }),
      /scope\.table "teams;"/
    )
    assertInvalidConfig(assert, invalid({ membershipsTable: '1members' }), /membershipsTable/)
    assertInvalidConfig(assert, invalid({ membershipsTable: '' }), /membershipsTable/)
  })

  test('2.3.6 rejects a key type outside integer, string and uuid', ({ assert }) => {
    assertInvalidConfig(
      assert,
      invalid({ users: { table: 'users', keyType: 'bigint' } }),
      /users\.keyType "bigint"/
    )
    assertInvalidConfig(
      assert,
      invalid({ scope: { table: 'teams', keyType: 'number' } }),
      /scope\.keyType "number"/
    )
  })

  test('accepts a config without an owner role and with a custom memberships table', ({
    assert,
  }) => {
    const ac = defineAccessControl({
      roles: ['member', 'manager'],
      users: { table: 'users', keyType: 'uuid' },
      scope: { table: 'workspaces', keyType: 'string' },
      membershipsTable: 'workspace_members',
      permissions: {
        members: { list: 'member', manage: 'manager' },
        invitations: { manage: 'manager' },
      },
    })
    assert.isUndefined(ac.ownerRole)
    assert.equal(ac.config.membershipsTable, 'workspace_members')
  })
})
