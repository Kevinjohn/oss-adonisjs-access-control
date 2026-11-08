import { test } from '@japa/runner'
import { codeOf, membershipFixture, type MembershipFixture } from './helpers/fixture.js'

const actor = (id: number | string) => ({ id })

test.group('memberships: trusted operations (spec 5.3 to 5.6)', (group) => {
  let f: MembershipFixture
  group.each.setup(async () => {
    f = await membershipFixture()
    return () => f.cleanup()
  })

  test('createFirstMember: owner role set, role input and SCOPE_NOT_EMPTY', async ({ assert }) => {
    const scope = await f.createScope()
    const [a, b] = await Promise.all([f.createUser(), f.createUser()])
    assert.equal(
      await codeOf(f.memberships.createFirstMember({ scopeId: scope, userId: a, role: 'admin' })),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    const first = await f.memberships.createFirstMember({ scopeId: scope, userId: a })
    assert.deepInclude(first, { role: 'owner', status: 'active' })
    assert.deepEqual(f.events, [
      { type: 'membership.first_member', scopeId: scope, userId: a, role: 'owner' },
    ])
    assert.equal(
      await codeOf(f.memberships.createFirstMember({ scopeId: scope, userId: b })),
      'E_ACCESS_CONTROL_SCOPE_NOT_EMPTY'
    )
    assert.equal(
      await codeOf(f.memberships.createFirstMember({ scopeId: 999_999, userId: b })),
      'E_ACCESS_CONTROL_SCOPE_NOT_FOUND'
    )
  })

  test('createFirstMember: without an owner role the role must manage members', async ({
    assert,
  }) => {
    const g = await membershipFixture({ owner: false })
    try {
      const scope = await g.createScope()
      const a = await g.createUser()
      assert.equal(
        await codeOf(g.memberships.createFirstMember({ scopeId: scope, userId: a })),
        'E_ACCESS_CONTROL_INVALID_INPUT'
      )
      assert.equal(
        await codeOf(
          g.memberships.createFirstMember({ scopeId: scope, userId: a, role: 'editor' })
        ),
        'E_ACCESS_CONTROL_INVALID_INPUT'
      )
      assert.equal(
        await codeOf(g.memberships.createFirstMember({ scopeId: scope, userId: a, role: 'ceo' })),
        'E_ACCESS_CONTROL_INVALID_INPUT'
      )
      assert.deepInclude(
        await g.memberships.createFirstMember({ scopeId: scope, userId: a, role: 'admin' }),
        { role: 'admin' }
      )
    } finally {
      await g.cleanup()
    }
  })

  test('acceptInvitation: requires trx, a known non-owner role and no membership', async ({
    assert,
  }) => {
    const scope = await f.createScope()
    const [o, u] = await Promise.all([f.createUser(), f.createUser()])
    await f.memberships.createFirstMember({ scopeId: scope, userId: o })
    f.events.length = 0
    assert.equal(
      await codeOf(
        f.memberships.acceptInvitation({
          scopeId: scope,
          userId: u,
          role: 'editor',
          invitationId: 1,
        } as never)
      ),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    const accepted = await f.runner.transaction(f.db, (trx) =>
      f.memberships.acceptInvitation({
        scopeId: scope,
        userId: u,
        role: 'editor',
        invitationId: 7,
        trx,
      })
    )
    assert.deepInclude(accepted, { userId: u, role: 'editor', status: 'active' })
    assert.deepEqual(f.events, [
      {
        type: 'membership.invitation_accepted',
        scopeId: scope,
        userId: u,
        role: 'editor',
        invitationId: 7,
      },
    ])
    const inTrx = (input: Record<string, unknown>) =>
      codeOf(
        f.runner.transaction(f.db, (trx) =>
          f.memberships.acceptInvitation({ ...input, trx } as never)
        )
      )
    assert.equal(
      await inTrx({ scopeId: scope, userId: u, role: 'editor', invitationId: 8 }),
      'E_ACCESS_CONTROL_ALREADY_MEMBER'
    )
    assert.equal(
      await inTrx({ scopeId: scope, userId: o, role: 'owner', invitationId: 9 }),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    const v = await f.createUser()
    assert.equal(
      await inTrx({ scopeId: scope, userId: v, role: 'owner', invitationId: 9 }),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    assert.equal(
      await inTrx({ scopeId: scope, userId: v, role: 'ceo', invitationId: 9 }),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    assert.equal(
      await inTrx({ scopeId: 999_999, userId: v, role: 'editor', invitationId: 9 }),
      'E_ACCESS_CONTROL_SCOPE_NOT_FOUND'
    )
  })

  test('grant: requires trx, a known non-owner role, an existing user and scope, and no membership', async ({
    assert,
  }) => {
    const scope = await f.createScope()
    const [o, u] = await Promise.all([f.createUser(), f.createUser()])
    await f.memberships.createFirstMember({ scopeId: scope, userId: o })
    f.events.length = 0
    assert.equal(
      await codeOf(f.memberships.grant({ scopeId: scope, userId: u, role: 'editor' } as never)),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    const inTrx = (input: Record<string, unknown>) =>
      codeOf(f.runner.transaction(f.db, (trx) => f.memberships.grant({ ...input, trx } as never)))
    assert.equal(
      await inTrx({ scopeId: scope, userId: u, role: 'owner' }),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    assert.equal(
      await inTrx({ scopeId: scope, userId: u, role: 'ceo' }),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    assert.equal(
      await inTrx({ scopeId: scope, userId: 999_999, role: 'editor' }),
      'E_ACCESS_CONTROL_USER_NOT_FOUND'
    )
    assert.equal(
      await inTrx({ scopeId: 999_999, userId: u, role: 'editor' }),
      'E_ACCESS_CONTROL_SCOPE_NOT_FOUND'
    )
    assert.deepEqual(f.events, [])
    const granted = await f.runner.transaction(f.db, (trx) =>
      f.memberships.grant({ scopeId: scope, userId: u, role: 'editor', trx })
    )
    assert.deepInclude(granted, { scopeId: scope, userId: u, role: 'editor', status: 'active' })
    assert.deepEqual(f.events.at(-1), {
      type: 'membership.granted',
      scopeId: scope,
      userId: u,
      role: 'editor',
    })
    assert.equal(
      await inTrx({ scopeId: scope, userId: u, role: 'viewer' }),
      'E_ACCESS_CONTROL_ALREADY_MEMBER'
    )
  })

  test('grant: an outer rollback and a throwing hook leave no row', async ({ assert }) => {
    const scope = await f.createScope()
    const u = await f.createUser()
    await assert.rejects(
      () =>
        f.runner.transaction(f.db, async (trx) => {
          await f.memberships.grant({ scopeId: scope, userId: u, role: 'editor', trx })
          throw new Error('outer')
        }),
      'outer'
    )
    assert.deepEqual(await f.rows(scope), [])
    const g = await membershipFixture({
      onMembershipChanged: async () => {
        throw new Error('hook')
      },
    })
    try {
      const hookScope = await g.createScope()
      const hookUser = await g.createUser()
      await assert.rejects(
        () =>
          g.runner.transaction(g.db, (trx) =>
            g.memberships.grant({ scopeId: hookScope, userId: hookUser, role: 'editor', trx })
          ),
        'hook'
      )
      assert.deepEqual(await g.rows(hookScope), [])
    } finally {
      await g.cleanup()
    }
  })

  test('identityRoles: actor map is active only, target map includes suspended', async ({
    assert,
  }) => {
    // One at a time, so the ids ascend s1 < s2 < s3 like the maps; parallel inserts may not.
    const s1 = await f.createScope()
    const s2 = await f.createScope()
    const s3 = await f.createScope()
    const [a, t] = await Promise.all([f.createUser(), f.createUser()])
    await f.memberships.createFirstMember({ scopeId: s1, userId: a })
    await f.memberships.createFirstMember({ scopeId: s2, userId: a })
    await f.memberships.createFirstMember({ scopeId: s3, userId: t })
    await f.memberships.add({ actor: actor(a), scopeId: s1, userId: t, role: 'viewer' })
    await f.memberships.add({ actor: actor(a), scopeId: s2, userId: t, role: 'editor' })
    await f.memberships.setStatus({ actor: actor(a), scopeId: s2, userId: t, status: 'suspended' })
    await f.memberships.add({ actor: actor(t), scopeId: s3, userId: a, role: 'admin' })
    await f.memberships.setStatus({ actor: actor(t), scopeId: s3, userId: a, status: 'suspended' })

    const { actorRoles, targetRoles } = await f.memberships.identityRoles({
      actorId: a,
      targetId: t,
    })
    assert.deepEqual(
      [...actorRoles.entries()],
      [
        [s1, 'owner'],
        [s2, 'owner'],
      ]
    )
    assert.deepEqual(
      [...targetRoles.entries()],
      [
        [s1, 'viewer'],
        [s2, 'editor'],
        [s3, 'owner'],
      ]
    )
    assert.equal(
      await codeOf(f.memberships.assertCanAdministerIdentity({ actorId: a, targetId: t })),
      'E_ACCESS_CONTROL_FORBIDDEN'
    )
    await f.memberships.leave({ scopeId: s3, userId: a })
    // The owner row cannot leave through the service; drop it directly to shape the next case.
    await f.db.from(f.names.memberships).where({ scope_id: s3, user_id: t }).delete()
    await f.memberships.assertCanAdministerIdentity({ actorId: a, targetId: t })
    const self = await f.memberships.identityRoles({ actorId: a, targetId: a })
    assert.deepEqual([...self.targetRoles.keys()], [s1, s2])
    await f.memberships.assertCanAdministerIdentity({ actorId: a, targetId: a })
    const nobody = await f.createUser()
    assert.equal(
      await codeOf(
        f.memberships.assertCanAdministerIdentity({ actorId: nobody, targetId: nobody })
      ),
      'E_ACCESS_CONTROL_FORBIDDEN'
    )
    assert.equal(
      await codeOf(f.memberships.identityRoles({ actorId: a, targetId: 'nope' })),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
  })

  test('prepareAccountDeletion: refuses an active owner, else removes every membership', async ({
    assert,
  }) => {
    const [s1, s2] = await Promise.all([f.createScope(), f.createScope()])
    const [o, u] = await Promise.all([f.createUser(), f.createUser()])
    await f.memberships.createFirstMember({ scopeId: s1, userId: o })
    await f.memberships.createFirstMember({ scopeId: s2, userId: u })
    await f.memberships.add({ actor: actor(o), scopeId: s1, userId: u, role: 'editor' })
    f.events.length = 0
    assert.equal(
      await codeOf(
        f.runner.transaction(f.db, (trx) =>
          f.memberships.prepareAccountDeletion({ userId: u, trx })
        )
      ),
      'E_ACCESS_CONTROL_LAST_OWNER'
    )
    assert.lengthOf(await f.memberships.listForUser(u), 2)
    await f.db.from(f.names.memberships).where({ scope_id: s2, user_id: u }).delete()
    f.events.length = 0
    await f.runner.transaction(f.db, async (trx) => {
      await f.memberships.prepareAccountDeletion({ userId: u, trx })
      await trx.from(f.names.users).where('id', u).delete()
    })
    assert.deepEqual(await f.memberships.listForUser(u), [])
    assert.deepEqual(f.events, [
      {
        type: 'membership.removed',
        scopeId: s1,
        userId: u,
        actorId: null,
        role: 'editor',
        reason: 'account_deleted',
      },
    ])
    assert.isNotOk(await f.db.from(f.names.users).where('id', u).first())
    assert.equal(
      await codeOf(f.memberships.prepareAccountDeletion({ userId: o } as never)),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    const nobody = await f.createUser()
    await f.runner.transaction(f.db, (trx) =>
      f.memberships.prepareAccountDeletion({ userId: nobody, trx })
    )
    assert.lengthOf(f.events, 1)
  })

  test('deleting a scope or user row with memberships present fails on the RESTRICT key', async ({
    assert,
  }) => {
    const s = await f.createScope()
    const o = await f.createUser()
    await f.memberships.createFirstMember({ scopeId: s, userId: o })
    await assert.rejects(() => f.db.from(f.names.scope).where('id', s).delete())
    await assert.rejects(() => f.db.from(f.names.users).where('id', o).delete())
    assert.isNotNull(await f.memberships.find(s, o))
  })

  test('removeAllForScope: one scope_deleted event per membership, then the scope row deletes', async ({
    assert,
  }) => {
    const s = await f.createScope()
    const [o, a, b] = await Promise.all([f.createUser(), f.createUser(), f.createUser()])
    await f.memberships.createFirstMember({ scopeId: s, userId: o })
    await f.memberships.add({ actor: actor(o), scopeId: s, userId: a, role: 'admin' })
    await f.memberships.add({ actor: actor(o), scopeId: s, userId: b, role: 'viewer' })
    f.events.length = 0
    await f.runner.transaction(f.db, async (trx) => {
      await f.memberships.removeAllForScope({ scopeId: s, actor: actor(o), trx })
      await trx.from(f.names.scope).where('id', s).delete()
    })
    assert.isNotOk(await f.db.from(f.names.scope).where('id', s).first())
    assert.deepEqual(
      f.events.map((e) => [
        e.type,
        'userId' in e ? e.userId : null,
        'reason' in e ? e.reason : null,
        'actorId' in e ? e.actorId : null,
      ]),
      [
        ['membership.removed', o, 'scope_deleted', o],
        ['membership.removed', a, 'scope_deleted', o],
        ['membership.removed', b, 'scope_deleted', o],
      ]
    )
    assert.equal(
      await codeOf(f.memberships.removeAllForScope({ scopeId: s } as never)),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    assert.equal(
      await codeOf(
        f.runner.transaction(f.db, (trx) => f.memberships.removeAllForScope({ scopeId: s, trx }))
      ),
      'E_ACCESS_CONTROL_SCOPE_NOT_FOUND'
    )
    const empty = await f.createScope()
    await f.runner.transaction(f.db, (trx) =>
      f.memberships.removeAllForScope({ scopeId: empty, trx })
    )
    assert.lengthOf(f.events, 3)
  })

  test('removeAllForScope: a member set that changes before the lock is a CONFLICT', async ({
    assert,
  }) => {
    const s = await f.createScope()
    const [o, a] = await Promise.all([f.createUser(), f.createUser()])
    await f.memberships.createFirstMember({ scopeId: s, userId: o })
    const spy = { ...f.runner, lockRow: f.runner.lockRow }
    let armed = true
    spy.lockRow = async (trx, table, id) => {
      if (armed && table === f.names.users) {
        armed = false
        // Through the same transaction: on SQLite the runner's writer lock would block another connection.
        await trx.table(f.names.memberships).insert({
          scope_id: s,
          user_id: a,
          role: 'viewer',
          status: 'active',
          created_at: f.runner.sqlTimestamp(trx),
          updated_at: f.runner.sqlTimestamp(trx),
        })
      }
      return f.runner.lockRow(trx, table, id)
    }
    f.config.attach(f.db, spy)
    assert.equal(
      await codeOf(
        f.runner.transaction(f.db, (trx) =>
          f.config.memberships.removeAllForScope({ scopeId: s, trx })
        )
      ),
      'E_ACCESS_CONTROL_CONFLICT'
    )
    assert.lengthOf(await f.rows(s), 1)
  })

  test('exportFor returns ISO timestamps', async ({ assert }) => {
    const s = await f.createScope()
    const o = await f.createUser()
    await f.memberships.createFirstMember({ scopeId: s, userId: o })
    const exported = await f.memberships.exportFor({ userId: o })
    assert.lengthOf(exported.memberships, 1)
    assert.deepInclude(exported.memberships[0], { scopeId: s, role: 'owner', status: 'active' })
    assert.match(exported.memberships[0].createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    assert.equal(exported.memberships[0].createdAt, exported.memberships[0].updatedAt)
    await f.runner.transaction(f.db, async (trx) => {
      const inTrx = await f.memberships.exportFor({ userId: o, trx })
      assert.lengthOf(inTrx.memberships, 1)
    })
  })
})
