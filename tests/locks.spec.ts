import { test } from '@japa/runner'
import { locksRows } from './helpers/database.js'
import { defineAccessControl } from '../index.js'
import { isCanonicalKey } from '../src/keys.js'
import { sameKeys } from '../src/locks.js'
import { codeOf, membershipFixture, type MembershipFixture } from './helpers/fixture.js'

const actor = (id: number | string) => ({ id })

/** Replaces the runner with one that records every lockRow call. */
function recordLocks(f: MembershipFixture) {
  const calls: Array<[string, number | string]> = []
  f.config.attach(f.db, {
    ...f.runner,
    async lockRow(trx, table, id) {
      calls.push([table, id])
      return f.runner.lockRow(trx, table, id)
    },
  })
  return calls
}

test.group('locks: order and scope existence (spec 4.2)', (group) => {
  let f: MembershipFixture
  group.each.setup(async () => {
    f = await membershipFixture()
    return () => f.cleanup()
  })

  test('user rows lock in String(key) order, then the scope row', async ({ assert }) => {
    const s = await f.createScope()
    const users: Array<number | string> = []
    for (let i = 0; i < 10; i++) users.push(await f.createUser())
    const nine = users[8]
    const ten = users[9]
    assert.equal(nine, 9)
    assert.equal(ten, 10)
    await f.memberships.createFirstMember({ scopeId: s, userId: nine })
    const calls = recordLocks(f)
    await f.config.memberships.add({ actor: actor(nine), scopeId: s, userId: ten, role: 'viewer' })
    assert.deepEqual(calls, [
      [f.names.users, 10],
      [f.names.users, 9],
      [f.names.scope, s],
    ])
    calls.length = 0
    await f.config.memberships.remove({ actor: actor(nine), scopeId: s, userId: ten })
    assert.deepEqual(calls, [
      [f.names.users, 10],
      [f.names.users, 9],
      [f.names.scope, s],
    ])
    calls.length = 0
    await f.config.memberships.leave({ scopeId: s, userId: nine }).catch(() => {})
    assert.deepEqual(calls, [
      [f.names.users, 9],
      [f.names.scope, s],
    ])
  })

  test('identity checks lock both users, then the union of scopes, ascending', async ({
    assert,
  }) => {
    const scopes: Array<number | string> = []
    for (let i = 0; i < 10; i++) scopes.push(await f.createScope())
    const [a, t] = await Promise.all([f.createUser(), f.createUser()])
    await f.memberships.createFirstMember({ scopeId: scopes[9], userId: a })
    await f.memberships.createFirstMember({ scopeId: scopes[8], userId: t })
    await f.memberships.createFirstMember({ scopeId: scopes[1], userId: a })
    await f.memberships.add({ actor: actor(a), scopeId: scopes[1], userId: t, role: 'viewer' })
    const calls = recordLocks(f)
    await f.config.memberships.identityRoles({ actorId: t, targetId: a })
    assert.deepEqual(calls, [
      [f.names.users, a],
      [f.names.users, t],
      [f.names.scope, 10],
      [f.names.scope, 2],
      [f.names.scope, 9],
    ])
    calls.length = 0
    await f.runner
      .transaction(f.db, (trx) => f.config.memberships.prepareAccountDeletion({ userId: t, trx }))
      .catch(() => {})
    assert.deepEqual(calls, [
      [f.names.scope, 2],
      [f.names.scope, 9],
    ])
  })

  test('removeAllForScope locks the member users ascending before the scope', async ({
    assert,
  }) => {
    const s = await f.createScope()
    const users: Array<number | string> = []
    for (let i = 0; i < 10; i++) users.push(await f.createUser())
    await f.memberships.createFirstMember({ scopeId: s, userId: users[8] })
    await f.memberships.add({
      actor: actor(users[8]),
      scopeId: s,
      userId: users[9],
      role: 'viewer',
    })
    await f.memberships.add({
      actor: actor(users[8]),
      scopeId: s,
      userId: users[0],
      role: 'viewer',
    })
    const calls = recordLocks(f)
    await f.runner.transaction(f.db, (trx) =>
      f.config.memberships.removeAllForScope({ scopeId: s, trx })
    )
    assert.deepEqual(calls, [
      [f.names.users, 1],
      [f.names.users, 10],
      [f.names.users, 9],
      [f.names.scope, s],
    ])
  })

  test('a missing scope row is SCOPE_NOT_FOUND after the lock', async ({ assert }) => {
    const u = await f.createUser()
    assert.equal(
      await codeOf(f.memberships.createFirstMember({ scopeId: 404, userId: u })),
      'E_ACCESS_CONTROL_SCOPE_NOT_FOUND'
    )
  })

  test('lockRow holds the row on engines that lock rows', async ({ assert }) => {
    const s = await f.createScope()
    const u = await f.createUser()
    await f.memberships.createFirstMember({ scopeId: s, userId: u })
    if (!locksRows) {
      assert.isTrue(true)
      return
    }
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    const holder = f.runner.transaction(f.db, async (trx) => {
      await f.runner.lockRow(trx, f.names.scope, s)
      await released
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const probe = f.db.transaction(async (trx) => {
      const sql =
        f.engine === 'pg'
          ? 'select id from ?? where id = ? for update nowait'
          : 'select id from ?? where id = ? for update nowait'
      await trx.rawQuery(sql, [f.names.scope, s]).exec()
    })
    const code = await probe.then(
      () => 'free',
      (error: { code?: string }) => error.code
    )
    release()
    await holder
    assert.equal(code, f.engine === 'pg' ? '55P03' : 'ER_LOCK_NOWAIT')
  })
})

test.group('locks: key types and custom tables', () => {
  test('uuid keys normalise to lower case and reject malformed values', async ({ assert }) => {
    const f = await membershipFixture({ keyType: 'uuid' })
    try {
      const s = await f.createScope()
      const [o, u] = await Promise.all([f.createUser(), f.createUser()])
      await f.memberships.createFirstMember({ scopeId: s, userId: o })
      const upper = await f.memberships.add({
        actor: actor(o),
        scopeId: String(s).toUpperCase(),
        userId: String(u).toUpperCase(),
        role: 'viewer',
      })
      assert.equal(upper.userId, u)
      assert.equal(upper.scopeId, s)
      assert.equal(
        await codeOf(f.memberships.find(s, 'not-a-uuid')),
        'E_ACCESS_CONTROL_INVALID_INPUT'
      )
      assert.equal(await codeOf(f.memberships.find(s, 12)), 'E_ACCESS_CONTROL_INVALID_INPUT')
    } finally {
      await f.cleanup()
    }
  })

  test('string keys accept 1 to 254 characters and a different scope key type', async ({
    assert,
  }) => {
    const f = await membershipFixture({ keyType: 'string', scopeKeyType: 'integer' })
    try {
      const s = await f.createScope()
      const [o, u] = await Promise.all([f.createUser(), f.createUser()])
      assert.isNumber(s)
      assert.isString(o)
      await f.memberships.createFirstMember({ scopeId: s, userId: o })
      await f.memberships.add({ actor: actor(o), scopeId: s, userId: u, role: 'viewer' })
      assert.equal(await codeOf(f.memberships.find(s, '')), 'E_ACCESS_CONTROL_INVALID_INPUT')
      assert.equal(
        await codeOf(f.memberships.find(s, 'x'.repeat(255))),
        'E_ACCESS_CONTROL_INVALID_INPUT'
      )
      assert.equal(await codeOf(f.memberships.find(s, 3)), 'E_ACCESS_CONTROL_INVALID_INPUT')
      assert.equal(await codeOf(f.memberships.find('1', o)), 'resolved')
      assert.equal(await codeOf(f.memberships.find('1.5', o)), 'E_ACCESS_CONTROL_INVALID_INPUT')
      assert.equal(
        await codeOf(f.memberships.find(Number.MAX_SAFE_INTEGER + 2, o)),
        'E_ACCESS_CONTROL_INVALID_INPUT'
      )
      assert.equal(await codeOf(f.memberships.find(0, o)), 'E_ACCESS_CONTROL_INVALID_INPUT')
    } finally {
      await f.cleanup()
    }
  })

  test('a custom membershipsTable is used for every query', async ({ assert }) => {
    const f = await membershipFixture({
      membershipsTable: `team_members_${Date.now().toString(36)}`,
    })
    try {
      const s = await f.createScope()
      const o = await f.createUser()
      await f.memberships.createFirstMember({ scopeId: s, userId: o })
      assert.lengthOf(await f.db.from(f.names.memberships), 1)
      assert.isNotNull(await f.memberships.find(s, o))
    } finally {
      await f.cleanup()
    }
  })

  test('the unique (scope_id, user_id) key rejects a duplicate row', async ({ assert }) => {
    const f = await membershipFixture()
    try {
      const s = await f.createScope()
      const o = await f.createUser()
      await f.memberships.createFirstMember({ scopeId: s, userId: o })
      const now = f.runner.sqlTimestamp(f.db.connection())
      await assert.rejects(() =>
        f.db.table(f.names.memberships).insert({
          scope_id: s,
          user_id: o,
          role: 'viewer',
          status: 'active',
          created_at: now,
          updated_at: now,
        })
      )
    } finally {
      await f.cleanup()
    }
  })

  test('memberships is unavailable until a database is attached', ({ assert }) => {
    const config = defineAccessControl({
      roles: ['viewer', 'owner'],
      ownerRole: 'owner',
      users: { table: 'users', keyType: 'integer' },
      scope: { table: 'teams', keyType: 'integer' },
      permissions: {
        members: { list: 'viewer', manage: 'viewer' },
        invitations: { manage: 'viewer' },
      },
    })
    assert.throws(() => config.memberships, /attach/)
  })
})

test.group('keys: pure helpers', () => {
  test('sameKeys compares the sorted key sets element by element', ({ assert }) => {
    assert.isTrue(sameKeys([2, 1], [1, 2]))
    assert.isTrue(sameKeys(['b', 'a'], ['a', 'b']))
    assert.isFalse(sameKeys(['a\nb'], ['a', 'b']))
    assert.isFalse(sameKeys([1], [1, 2]))
    assert.isFalse(sameKeys([], [1]))
  })

  test('isCanonicalKey accepts only the normalised spelling of a key', ({ assert }) => {
    assert.isTrue(isCanonicalKey('integer', '7'))
    assert.isFalse(isCanonicalKey('integer', '07'))
    assert.isFalse(isCanonicalKey('integer', 'x'))
    assert.isTrue(isCanonicalKey('uuid', '0f7b3f1e-3f5c-4f6a-9d2e-1c2b3a4d5e6f'))
    assert.isFalse(isCanonicalKey('uuid', '0F7B3F1E-3F5C-4F6A-9D2E-1C2B3A4D5E6F'))
    assert.isTrue(isCanonicalKey('string', 'Team A'))
    assert.isFalse(isCanonicalKey('string', ''))
  })
})

test.group('keys: case-insensitive string keys (MySQL default collation)', () => {
  test('string keys are locked, stored and compared by the spelling the parent row holds', async ({
    assert,
  }) => {
    const f = await membershipFixture({ keyType: 'string', caseInsensitiveKeys: true })
    try {
      if (!f.caseInsensitiveKeys) return
      const upper = (key: number | string) => String(key).toUpperCase()
      const scope = await f.createScope()
      const [owner, other, third] = await Promise.all([
        f.createUser(),
        f.createUser(),
        f.createUser(),
      ])
      const calls = recordLocks(f)
      const first = await f.config.memberships.createFirstMember({
        scopeId: upper(scope),
        userId: upper(owner),
      })
      assert.deepEqual([first.scopeId, first.userId], [scope, owner])
      const added = await f.config.memberships.add({
        actor: actor(upper(owner)),
        scopeId: upper(scope),
        userId: upper(other),
        role: 'admin',
      })
      assert.deepEqual([added.scopeId, added.userId], [scope, other])
      const rows = await f.rows(scope)
      assert.deepEqual(
        rows.map((row) => [row.scope_id, row.user_id]),
        [
          [scope, owner],
          [scope, other],
        ]
      )
      assert.deepEqual(
        f.events.map((event) => ('userId' in event ? [event.scopeId, event.userId] : null)),
        [
          [scope, owner],
          [scope, other],
        ]
      )
      // The actor targeting an alias of their own key is self-management, not a role change.
      assert.equal(
        await codeOf(
          f.config.memberships.changeRole({
            actor: actor(owner),
            scopeId: scope,
            userId: upper(owner),
            role: 'admin',
          })
        ),
        'E_ACCESS_CONTROL_SELF_MANAGEMENT'
      )
      // Locks follow the stored spellings, whatever the caller wrote.
      calls.length = 0
      await f.config.memberships.add({
        actor: actor(upper(other)),
        scopeId: upper(scope),
        userId: upper(third),
        role: 'viewer',
      })
      assert.deepEqual(calls, [
        [f.names.users, other],
        [f.names.users, third],
        [f.names.scope, scope],
      ])
    } finally {
      await f.cleanup()
    }
  })
})
