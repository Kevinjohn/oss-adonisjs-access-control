import { test } from '@japa/runner'
import { defineAccessControl } from '../index.js'

const withOwner = defineAccessControl({
  roles: ['viewer', 'editor', 'admin', 'owner'],
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  permissions: {
    project: { read: 'viewer', write: 'editor', archive: 'admin' },
    members: { list: 'admin', manage: 'admin' },
    invitations: { manage: 'admin' },
  },
})

const withoutOwner = defineAccessControl({
  roles: ['viewer', 'editor', 'admin'],
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  permissions: {
    project: { read: 'viewer', write: 'editor', archive: 'admin' },
    members: { list: 'admin', manage: 'admin' },
    invitations: { manage: 'admin' },
  },
})

const ALLOWED = { allowed: true } as const
const denied = (code: string) => ({ allowed: false, code: `E_ACCESS_CONTROL_${code}` })

test.group('rules: rank, can and permissionsFor (spec 3)', () => {
  test('rank is the index in roles, -1 when unknown', ({ assert }) => {
    assert.equal(withOwner.rank('viewer'), 0)
    assert.equal(withOwner.rank('owner'), 3)
    assert.equal(withOwner.rank('ceo'), -1)
    assert.equal(withOwner.rank(''), -1)
  })

  test('can per key per role', ({ assert }) => {
    const table: Record<string, Record<string, boolean>> = {
      'project:read': { viewer: true, editor: true, admin: true, owner: true },
      'project:write': { viewer: false, editor: true, admin: true, owner: true },
      'project:archive': { viewer: false, editor: false, admin: true, owner: true },
      'members:list': { viewer: false, editor: false, admin: true, owner: true },
      'members:manage': { viewer: false, editor: false, admin: true, owner: true },
      'invitations:manage': { viewer: false, editor: false, admin: true, owner: true },
    }
    for (const [key, byRole] of Object.entries(table))
      for (const [role, expected] of Object.entries(byRole))
        assert.equal(withOwner.can(role, key), expected, `${role} ${key}`)
  })

  test('can denies unknown roles and unknown keys', ({ assert }) => {
    assert.isFalse(withOwner.can('ceo', 'project:read'))
    assert.isFalse(withOwner.can('owner', 'project:delete'))
    assert.isFalse(withOwner.can('owner', 'project.read'))
    assert.isFalse(withOwner.can('owner', ''))
  })

  test('permissionsFor lists the keys the role satisfies, in declaration order', ({ assert }) => {
    assert.deepEqual(withOwner.permissionsFor('viewer'), ['project:read'])
    assert.deepEqual(withOwner.permissionsFor('editor'), ['project:read', 'project:write'])
    assert.deepEqual(withOwner.permissionsFor('owner'), [
      'project:read',
      'project:write',
      'project:archive',
      'members:list',
      'members:manage',
      'invitations:manage',
    ])
    assert.deepEqual(withOwner.permissionsFor('ceo'), [])
  })
})

test.group('rules: assignableRoles (spec 3)', () => {
  test('is empty without members:manage', ({ assert }) => {
    assert.deepEqual(withOwner.assignableRoles('viewer'), [])
    assert.deepEqual(withOwner.assignableRoles('editor'), [])
    assert.deepEqual(withOwner.assignableRoles('ceo'), [])
  })

  test('lists roles up to the actor rank, never the owner role', ({ assert }) => {
    assert.deepEqual(withOwner.assignableRoles('admin'), ['viewer', 'editor', 'admin'])
    assert.deepEqual(withOwner.assignableRoles('owner'), ['viewer', 'editor', 'admin'])
  })

  test('includes the highest role when no owner role is set', ({ assert }) => {
    assert.deepEqual(withoutOwner.assignableRoles('admin'), ['viewer', 'editor', 'admin'])
  })
})

test.group('rules: canManage truth table (spec 3.1)', () => {
  test('row 1: unknown actor or target role denies UNKNOWN_ROLE before anything else', ({
    assert,
  }) => {
    assert.deepEqual(
      withOwner.canManage({ actorRole: 'ceo', targetRole: 'viewer', isSelf: true }),
      denied('UNKNOWN_ROLE')
    )
    assert.deepEqual(
      withOwner.canManage({ actorRole: 'owner', targetRole: 'ceo', isSelf: false }),
      denied('UNKNOWN_ROLE')
    )
  })

  test('row 2: self denies SELF_MANAGEMENT before the permission check', ({ assert }) => {
    assert.deepEqual(
      withOwner.canManage({ actorRole: 'viewer', targetRole: 'viewer', isSelf: true }),
      denied('SELF_MANAGEMENT')
    )
    assert.deepEqual(
      withOwner.canManage({ actorRole: 'owner', targetRole: 'owner', isSelf: true }),
      denied('SELF_MANAGEMENT')
    )
  })

  test('row 3: an actor without members:manage is FORBIDDEN before the owner check', ({
    assert,
  }) => {
    assert.deepEqual(
      withOwner.canManage({ actorRole: 'editor', targetRole: 'viewer', isSelf: false }),
      denied('FORBIDDEN')
    )
    assert.deepEqual(
      withOwner.canManage({ actorRole: 'editor', targetRole: 'owner', isSelf: false }),
      denied('FORBIDDEN')
    )
  })

  test('row 4: the owner is OWNER_PROTECTED before the rank check', ({ assert }) => {
    assert.deepEqual(
      withOwner.canManage({ actorRole: 'admin', targetRole: 'owner', isSelf: false }),
      denied('OWNER_PROTECTED')
    )
  })

  test('row 5: a higher-ranked target is RANK_TOO_LOW', ({ assert }) => {
    assert.deepEqual(
      withoutOwner.canManage({ actorRole: 'admin', targetRole: 'admin', isSelf: false }),
      ALLOWED
    )
    const lowerManager = defineAccessControl({
      roles: ['viewer', 'manager', 'admin'],
      users: { table: 'users', keyType: 'integer' },
      scope: { table: 'teams', keyType: 'integer' },
      permissions: {
        members: { list: 'manager', manage: 'manager' },
        invitations: { manage: 'manager' },
      },
    })
    assert.deepEqual(
      lowerManager.canManage({ actorRole: 'manager', targetRole: 'admin', isSelf: false }),
      denied('RANK_TOO_LOW')
    )
  })

  test('row 6: equal or lower rank is allowed', ({ assert }) => {
    assert.deepEqual(
      withOwner.canManage({ actorRole: 'admin', targetRole: 'admin', isSelf: false }),
      ALLOWED
    )
    assert.deepEqual(
      withOwner.canManage({ actorRole: 'admin', targetRole: 'viewer', isSelf: false }),
      ALLOWED
    )
    assert.deepEqual(
      withOwner.canManage({ actorRole: 'owner', targetRole: 'admin', isSelf: false }),
      ALLOWED
    )
  })

  test('without an owner role the highest role can be managed by its peers', ({ assert }) => {
    assert.deepEqual(
      withoutOwner.canManage({ actorRole: 'admin', targetRole: 'admin', isSelf: false }),
      ALLOWED
    )
  })
})

test.group('rules: canAssign (spec 3.2)', () => {
  test('applies canManage first', ({ assert }) => {
    assert.deepEqual(
      withOwner.canAssign({
        actorRole: 'ceo',
        targetRole: 'viewer',
        nextRole: 'ceo',
        isSelf: false,
      }),
      denied('UNKNOWN_ROLE')
    )
    assert.deepEqual(
      withOwner.canAssign({
        actorRole: 'admin',
        targetRole: 'admin',
        nextRole: 'viewer',
        isSelf: true,
      }),
      denied('SELF_MANAGEMENT')
    )
    assert.deepEqual(
      withOwner.canAssign({
        actorRole: 'editor',
        targetRole: 'viewer',
        nextRole: 'editor',
        isSelf: false,
      }),
      denied('FORBIDDEN')
    )
    assert.deepEqual(
      withOwner.canAssign({
        actorRole: 'admin',
        targetRole: 'owner',
        nextRole: 'viewer',
        isSelf: false,
      }),
      denied('OWNER_PROTECTED')
    )
  })

  test('row 1: an unknown next role is UNKNOWN_ROLE', ({ assert }) => {
    assert.deepEqual(
      withOwner.canAssign({
        actorRole: 'admin',
        targetRole: 'viewer',
        nextRole: 'ceo',
        isSelf: false,
      }),
      denied('UNKNOWN_ROLE')
    )
  })

  test('row 2: assigning the owner role is OWNER_PROTECTED before the rank check', ({ assert }) => {
    assert.deepEqual(
      withOwner.canAssign({
        actorRole: 'owner',
        targetRole: 'admin',
        nextRole: 'owner',
        isSelf: false,
      }),
      denied('OWNER_PROTECTED')
    )
    assert.deepEqual(
      withOwner.canAssign({
        actorRole: 'admin',
        targetRole: 'admin',
        nextRole: 'owner',
        isSelf: false,
      }),
      denied('OWNER_PROTECTED')
    )
  })

  test('row 3: a next role above the actor is RANK_TOO_LOW', ({ assert }) => {
    const lowerManager = defineAccessControl({
      roles: ['viewer', 'manager', 'admin'],
      users: { table: 'users', keyType: 'integer' },
      scope: { table: 'teams', keyType: 'integer' },
      permissions: {
        members: { list: 'manager', manage: 'manager' },
        invitations: { manage: 'manager' },
      },
    })
    assert.deepEqual(
      lowerManager.canAssign({
        actorRole: 'manager',
        targetRole: 'viewer',
        nextRole: 'admin',
        isSelf: false,
      }),
      denied('RANK_TOO_LOW')
    )
  })

  test('row 4: otherwise allowed, including promotion to the actor rank', ({ assert }) => {
    assert.deepEqual(
      withOwner.canAssign({
        actorRole: 'admin',
        targetRole: 'viewer',
        nextRole: 'admin',
        isSelf: false,
      }),
      ALLOWED
    )
    assert.deepEqual(
      withOwner.canAssign({
        actorRole: 'admin',
        targetRole: 'admin',
        nextRole: 'viewer',
        isSelf: false,
      }),
      ALLOWED
    )
    assert.deepEqual(
      withoutOwner.canAssign({
        actorRole: 'admin',
        targetRole: 'viewer',
        nextRole: 'admin',
        isSelf: false,
      }),
      ALLOWED
    )
  })
})

test.group('rules: canAdministerIdentity (spec 3.4)', () => {
  const roles = (entries: Array<[number | string, string]>) => new Map(entries)

  test('an empty target map is false, even for self', ({ assert }) => {
    assert.isFalse(withOwner.canAdministerIdentity(roles([[1, 'owner']]), roles([]), false))
    assert.isFalse(withOwner.canAdministerIdentity(roles([[1, 'owner']]), roles([]), true))
  })

  test('self with a non-empty target map is true', ({ assert }) => {
    assert.isTrue(withOwner.canAdministerIdentity(roles([]), roles([[1, 'viewer']]), true))
    assert.isTrue(
      withOwner.canAdministerIdentity(roles([[1, 'owner']]), roles([[1, 'owner']]), true)
    )
  })

  test('a scope where the actor has no membership is false', ({ assert }) => {
    assert.isFalse(
      withOwner.canAdministerIdentity(
        roles([[1, 'admin']]),
        roles([
          [1, 'viewer'],
          [2, 'viewer'],
        ]),
        false
      )
    )
  })

  test('every target scope must pass canManage, including suspended target scopes', ({
    assert,
  }) => {
    assert.isTrue(
      withOwner.canAdministerIdentity(
        roles([
          [1, 'admin'],
          [2, 'owner'],
        ]),
        roles([
          [1, 'editor'],
          [2, 'admin'],
        ]),
        false
      )
    )
    assert.isFalse(
      withOwner.canAdministerIdentity(
        roles([
          [1, 'admin'],
          [2, 'editor'],
        ]),
        roles([
          [1, 'editor'],
          [2, 'viewer'],
        ]),
        false
      )
    )
    assert.isFalse(
      withOwner.canAdministerIdentity(
        roles([[1, 'admin']]),
        roles([
          [1, 'viewer'],
          ['10', 'viewer'],
        ]),
        false
      )
    )
  })

  test('an admin cannot administer an owner anywhere', ({ assert }) => {
    assert.isFalse(
      withOwner.canAdministerIdentity(
        roles([
          [1, 'admin'],
          [2, 'admin'],
        ]),
        roles([
          [1, 'viewer'],
          [2, 'owner'],
        ]),
        false
      )
    )
    assert.isFalse(
      withOwner.canAdministerIdentity(roles([[1, 'owner']]), roles([[1, 'owner']]), false)
    )
  })

  test('keys compare by map identity, so a numeric and a string key are different scopes', ({
    assert,
  }) => {
    assert.isFalse(
      withOwner.canAdministerIdentity(roles([['1', 'admin']]), roles([[1, 'viewer']]), false)
    )
  })
})
