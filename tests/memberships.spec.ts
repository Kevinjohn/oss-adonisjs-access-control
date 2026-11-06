import { test } from '@japa/runner'
import { AccessControlError } from '../index.js'
import { codeOf, membershipFixture, type MembershipFixture } from './helpers/fixture.js'

test.group('memberships: ordinary operations (spec 5.2)', (group) => {
  let f: MembershipFixture
  let scope: number | string
  let owner: number | string
  let admin: number | string
  let editor: number | string
  let viewer: number | string
  let outsider: number | string
  const actor = (id: number | string) => ({ id })

  group.each.setup(async () => {
    f = await membershipFixture()
    scope = await f.createScope()
    ;[owner, admin, editor, viewer, outsider] = await Promise.all([
      f.createUser(),
      f.createUser(),
      f.createUser(),
      f.createUser(),
      f.createUser(),
    ])
    await f.memberships.createFirstMember({ scopeId: scope, userId: owner })
    await f.memberships.add({ actor: actor(owner), scopeId: scope, userId: admin, role: 'admin' })
    await f.memberships.add({ actor: actor(owner), scopeId: scope, userId: editor, role: 'editor' })
    await f.memberships.add({ actor: actor(owner), scopeId: scope, userId: viewer, role: 'viewer' })
    f.events.length = 0
    return () => f.cleanup()
  })

  test('add: happy path returns the membership and emits membership.added', async ({ assert }) => {
    const membership = await f.memberships.add({
      actor: actor(admin),
      scopeId: scope,
      userId: outsider,
      role: 'editor',
    })
    assert.deepInclude(membership, {
      scopeId: scope,
      userId: outsider,
      role: 'editor',
      status: 'active',
    })
    assert.isTrue(membership.createdAt.isValid)
    assert.equal(membership.createdAt.toMillis(), membership.updatedAt.toMillis())
    assert.deepEqual(f.events, [
      {
        type: 'membership.added',
        scopeId: scope,
        userId: outsider,
        actorId: admin,
        role: 'editor',
      },
    ])
    assert.deepInclude(await f.memberships.find(scope, outsider), {
      role: 'editor',
      status: 'active',
    })
  })

  test('add: each error code', async ({ assert }) => {
    const add = (who: number | string, userId: number | string, role: string) =>
      codeOf(f.memberships.add({ actor: actor(who), scopeId: scope, userId, role }))
    assert.equal(await add(outsider, viewer, 'viewer'), 'E_ACCESS_CONTROL_FORBIDDEN')
    assert.equal(await add(editor, outsider, 'viewer'), 'E_ACCESS_CONTROL_FORBIDDEN')
    assert.equal(await add(admin, 999_999, 'viewer'), 'E_ACCESS_CONTROL_USER_NOT_FOUND')
    assert.equal(await add(admin, viewer, 'viewer'), 'E_ACCESS_CONTROL_ALREADY_MEMBER')
    assert.equal(await add(admin, outsider, 'ceo'), 'E_ACCESS_CONTROL_UNKNOWN_ROLE')
    assert.equal(await add(admin, outsider, 'owner'), 'E_ACCESS_CONTROL_OWNER_PROTECTED')
    assert.equal(await add(owner, outsider, 'owner'), 'E_ACCESS_CONTROL_OWNER_PROTECTED')
    // Role rows come before the user lookup, so a missing user cannot be told apart by the role.
    assert.equal(await add(admin, 999_999, 'ceo'), 'E_ACCESS_CONTROL_UNKNOWN_ROLE')
    assert.equal(await add(admin, 999_999, 'owner'), 'E_ACCESS_CONTROL_OWNER_PROTECTED')
    assert.equal(await add(admin, viewer, 'owner'), 'E_ACCESS_CONTROL_OWNER_PROTECTED')
    assert.equal(
      await codeOf(
        f.memberships.add({
          actor: actor(admin),
          scopeId: 999_999,
          userId: outsider,
          role: 'viewer',
        })
      ),
      'E_ACCESS_CONTROL_SCOPE_NOT_FOUND'
    )
    assert.equal(
      await codeOf(
        f.memberships.add({ actor: actor(admin), scopeId: scope, userId: 'abc', role: 'viewer' })
      ),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    assert.equal(
      await codeOf(
        f.memberships.add({ actor: actor(admin), scopeId: -1, userId: outsider, role: 'viewer' })
      ),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    assert.lengthOf(f.events, 0)
  })

  test('add: a suspended actor is FORBIDDEN', async ({ assert }) => {
    await f.memberships.setStatus({
      actor: actor(owner),
      scopeId: scope,
      userId: admin,
      status: 'suspended',
    })
    assert.equal(
      await codeOf(
        f.memberships.add({ actor: actor(admin), scopeId: scope, userId: outsider, role: 'viewer' })
      ),
      'E_ACCESS_CONTROL_FORBIDDEN'
    )
  })

  test('add and changeRole at equal rank are allowed; a target outside the scope is NOT_A_MEMBER', async ({
    assert,
  }) => {
    const lower = await membershipFixture({ owner: false })
    try {
      const s = await lower.createScope()
      const [a, b] = await Promise.all([lower.createUser(), lower.createUser()])
      await lower.memberships.createFirstMember({ scopeId: s, userId: a, role: 'admin' })
      await lower.memberships.add({ actor: actor(a), scopeId: s, userId: b, role: 'admin' })
      const c = await lower.createUser()
      assert.deepInclude(
        await lower.memberships.add({ actor: actor(b), scopeId: s, userId: c, role: 'admin' }),
        { role: 'admin' }
      )
    } finally {
      await lower.cleanup()
    }
    const manager = await membershipFixture()
    try {
      const s = await manager.createScope()
      const [o, a, b] = await Promise.all([
        manager.createUser(),
        manager.createUser(),
        manager.createUser(),
      ])
      await manager.memberships.createFirstMember({ scopeId: s, userId: o })
      await manager.memberships.add({ actor: actor(o), scopeId: s, userId: a, role: 'admin' })
      await manager.memberships.changeRole({
        actor: actor(o),
        scopeId: s,
        userId: a,
        role: 'admin',
      })
      assert.equal(
        await codeOf(
          manager.memberships.changeRole({ actor: actor(a), scopeId: s, userId: b, role: 'admin' })
        ),
        'E_ACCESS_CONTROL_NOT_A_MEMBER'
      )
    } finally {
      await manager.cleanup()
    }
  })

  test('changeRole: happy path, unchanged skip and errors', async ({ assert }) => {
    const changed = await f.memberships.changeRole({
      actor: actor(admin),
      scopeId: scope,
      userId: viewer,
      role: 'editor',
    })
    assert.deepInclude(changed, { userId: viewer, role: 'editor' })
    assert.deepEqual(f.events, [
      {
        type: 'membership.role_changed',
        scopeId: scope,
        userId: viewer,
        actorId: admin,
        from: 'viewer',
        to: 'editor',
      },
    ])
    const before = await f.memberships.find(scope, viewer)
    const same = await f.memberships.changeRole({
      actor: actor(admin),
      scopeId: scope,
      userId: viewer,
      role: 'editor',
    })
    assert.equal(same.updatedAt.toMillis(), before!.updatedAt.toMillis())
    assert.lengthOf(f.events, 1)

    const change = (who: number | string, userId: number | string, role: string) =>
      codeOf(f.memberships.changeRole({ actor: actor(who), scopeId: scope, userId, role }))
    assert.equal(await change(editor, viewer, 'viewer'), 'E_ACCESS_CONTROL_FORBIDDEN')
    assert.equal(await change(admin, outsider, 'viewer'), 'E_ACCESS_CONTROL_NOT_A_MEMBER')
    assert.equal(await change(admin, admin, 'viewer'), 'E_ACCESS_CONTROL_SELF_MANAGEMENT')
    assert.equal(await change(admin, owner, 'viewer'), 'E_ACCESS_CONTROL_OWNER_PROTECTED')
    assert.equal(await change(admin, viewer, 'owner'), 'E_ACCESS_CONTROL_OWNER_PROTECTED')
    assert.equal(await change(admin, viewer, 'ceo'), 'E_ACCESS_CONTROL_UNKNOWN_ROLE')
    assert.equal(await change(owner, viewer, 'admin'), 'resolved')
    assert.lengthOf(f.events, 2)
  })

  test('changeRole: a stored role outside the tuple denies with UNKNOWN_ROLE', async ({
    assert,
  }) => {
    await f.db
      .from(f.names.memberships)
      .where({ scope_id: scope, user_id: viewer })
      .update({ role: 'ghost' })
    assert.equal(
      await codeOf(
        f.memberships.changeRole({
          actor: actor(admin),
          scopeId: scope,
          userId: viewer,
          role: 'editor',
        })
      ),
      'E_ACCESS_CONTROL_UNKNOWN_ROLE'
    )
    await f.db
      .from(f.names.memberships)
      .where({ scope_id: scope, user_id: admin })
      .update({ role: 'ghost' })
    assert.equal(
      await codeOf(
        f.memberships.add({ actor: actor(admin), scopeId: scope, userId: outsider, role: 'viewer' })
      ),
      'E_ACCESS_CONTROL_UNKNOWN_ROLE'
    )
    assert.isFalse(f.config.can('ghost', 'project:read'))
  })

  test('setStatus: happy path, unchanged skip and errors', async ({ assert }) => {
    const suspended = await f.memberships.setStatus({
      actor: actor(admin),
      scopeId: scope,
      userId: editor,
      status: 'suspended',
    })
    assert.equal(suspended.status, 'suspended')
    assert.deepEqual(f.events, [
      {
        type: 'membership.status_changed',
        scopeId: scope,
        userId: editor,
        actorId: admin,
        from: 'active',
        to: 'suspended',
      },
    ])
    await f.memberships.setStatus({
      actor: actor(admin),
      scopeId: scope,
      userId: editor,
      status: 'suspended',
    })
    assert.lengthOf(f.events, 1)
    const reactivated = await f.memberships.setStatus({
      actor: actor(admin),
      scopeId: scope,
      userId: editor,
      status: 'active',
    })
    assert.equal(reactivated.status, 'active')
    assert.lengthOf(f.events, 2)

    const set = (who: number | string, userId: number | string, status: string) =>
      codeOf(
        f.memberships.setStatus({
          actor: actor(who),
          scopeId: scope,
          userId,
          status: status as 'active',
        })
      )
    assert.equal(await set(editor, viewer, 'suspended'), 'E_ACCESS_CONTROL_FORBIDDEN')
    assert.equal(await set(admin, outsider, 'suspended'), 'E_ACCESS_CONTROL_NOT_A_MEMBER')
    assert.equal(await set(admin, admin, 'suspended'), 'E_ACCESS_CONTROL_SELF_MANAGEMENT')
    assert.equal(await set(admin, owner, 'suspended'), 'E_ACCESS_CONTROL_OWNER_PROTECTED')
    assert.equal(await set(admin, viewer, 'banned'), 'E_ACCESS_CONTROL_INVALID_INPUT')
  })

  test('remove: happy path and errors', async ({ assert }) => {
    await f.memberships.remove({ actor: actor(admin), scopeId: scope, userId: viewer })
    assert.isNull(await f.memberships.find(scope, viewer))
    assert.deepEqual(f.events, [
      {
        type: 'membership.removed',
        scopeId: scope,
        userId: viewer,
        actorId: admin,
        role: 'viewer',
        reason: 'removed',
      },
    ])
    const remove = (who: number | string, userId: number | string) =>
      codeOf(f.memberships.remove({ actor: actor(who), scopeId: scope, userId }))
    assert.equal(await remove(editor, viewer), 'E_ACCESS_CONTROL_FORBIDDEN')
    assert.equal(await remove(admin, viewer), 'E_ACCESS_CONTROL_NOT_A_MEMBER')
    assert.equal(await remove(admin, admin), 'E_ACCESS_CONTROL_SELF_MANAGEMENT')
    assert.equal(await remove(admin, owner), 'E_ACCESS_CONTROL_OWNER_PROTECTED')
    assert.equal(await remove(owner, admin), 'resolved')
  })

  test('a non-manager gets 403, not 404, for a missing target', async ({ assert }) => {
    for (const method of ['changeRole', 'setStatus', 'remove'] as const) {
      const input = {
        actor: actor(viewer),
        scopeId: scope,
        userId: outsider,
        role: 'viewer',
        status: 'active',
      } as const
      assert.equal(await codeOf(f.memberships[method](input)), 'E_ACCESS_CONTROL_FORBIDDEN', method)
    }
  })

  test('leave: a member leaves, a suspended member leaves, the owner cannot', async ({
    assert,
  }) => {
    await f.memberships.leave({ scopeId: scope, userId: viewer })
    assert.isNull(await f.memberships.find(scope, viewer))
    assert.deepEqual(f.events, [
      { type: 'membership.left', scopeId: scope, userId: viewer, role: 'viewer' },
    ])
    await f.memberships.setStatus({
      actor: actor(owner),
      scopeId: scope,
      userId: editor,
      status: 'suspended',
    })
    await f.memberships.leave({ scopeId: scope, userId: editor })
    assert.isNull(await f.memberships.find(scope, editor))
    assert.equal(
      await codeOf(f.memberships.leave({ scopeId: scope, userId: owner })),
      'E_ACCESS_CONTROL_OWNER_PROTECTED'
    )
    assert.equal(
      await codeOf(f.memberships.leave({ scopeId: scope, userId: outsider })),
      'E_ACCESS_CONTROL_NOT_A_MEMBER'
    )
    assert.equal(
      await codeOf(f.memberships.leave({ scopeId: 999_999, userId: outsider })),
      'E_ACCESS_CONTROL_NOT_A_MEMBER',
      'a missing scope reads like a missing membership: leave is open to every signed-in user'
    )
  })

  test('transferOwnership: demotes the old owner to the highest non-owner role atomically', async ({
    assert,
  }) => {
    await f.memberships.transferOwnership({ actor: actor(owner), scopeId: scope, toUserId: editor })
    assert.equal((await f.memberships.find(scope, owner))!.role, 'admin')
    assert.equal((await f.memberships.find(scope, editor))!.role, 'owner')
    assert.deepEqual(f.events, [
      {
        type: 'membership.ownership_transferred',
        scopeId: scope,
        fromUserId: owner,
        toUserId: editor,
        demotedTo: 'admin',
      },
    ])
    const owners = await f.db.from(f.names.memberships).where({ scope_id: scope, role: 'owner' })
    assert.lengthOf(owners, 1)
  })

  test('transferOwnership: a failure mid-way rolls back both role writes', async ({ assert }) => {
    const failing = await membershipFixture({
      async onMembershipChanged(event) {
        if (event.type === 'membership.ownership_transferred') throw new Error('audit log down')
      },
    })
    try {
      const s = await failing.createScope()
      const [o, e] = await Promise.all([failing.createUser(), failing.createUser()])
      await failing.memberships.createFirstMember({ scopeId: s, userId: o })
      await failing.memberships.add({ actor: actor(o), scopeId: s, userId: e, role: 'editor' })
      await assert.rejects(
        () => failing.memberships.transferOwnership({ actor: actor(o), scopeId: s, toUserId: e }),
        /audit log down/
      )
      assert.equal((await failing.memberships.find(s, o))!.role, 'owner')
      assert.equal((await failing.memberships.find(s, e))!.role, 'editor')
    } finally {
      await failing.cleanup()
    }
  })

  test('transferOwnership: each error code', async ({ assert }) => {
    const transfer = (who: number | string, toUserId: number | string) =>
      codeOf(f.memberships.transferOwnership({ actor: actor(who), scopeId: scope, toUserId }))
    assert.equal(await transfer(admin, editor), 'E_ACCESS_CONTROL_FORBIDDEN')
    assert.equal(await transfer(outsider, editor), 'E_ACCESS_CONTROL_FORBIDDEN')
    assert.equal(await transfer(owner, owner), 'E_ACCESS_CONTROL_SELF_MANAGEMENT')
    assert.equal(await transfer(owner, outsider), 'E_ACCESS_CONTROL_NOT_A_MEMBER')
    await f.memberships.setStatus({
      actor: actor(owner),
      scopeId: scope,
      userId: editor,
      status: 'suspended',
    })
    assert.equal(await transfer(owner, editor), 'E_ACCESS_CONTROL_INVALID_INPUT')
    const noOwner = await membershipFixture({ owner: false })
    try {
      const s = await noOwner.createScope()
      const [a, b] = await Promise.all([noOwner.createUser(), noOwner.createUser()])
      await noOwner.memberships.createFirstMember({ scopeId: s, userId: a, role: 'admin' })
      await noOwner.memberships.add({ actor: actor(a), scopeId: s, userId: b, role: 'viewer' })
      assert.equal(
        await codeOf(
          noOwner.memberships.transferOwnership({ actor: actor(a), scopeId: s, toUserId: b })
        ),
        'E_ACCESS_CONTROL_OWNER_DISABLED'
      )
    } finally {
      await noOwner.cleanup()
    }
  })

  test('onMembershipChanged throwing rolls back the write', async ({ assert }) => {
    const failing = await membershipFixture({
      async onMembershipChanged(event) {
        if (event.type === 'membership.added')
          throw new AccessControlError('E_ACCESS_CONTROL_INVALID_INPUT', { message: 'nope' })
      },
    })
    try {
      const s = await failing.createScope()
      const [o, u] = await Promise.all([failing.createUser(), failing.createUser()])
      await failing.memberships.createFirstMember({ scopeId: s, userId: o })
      assert.equal(
        await codeOf(
          failing.memberships.add({ actor: actor(o), scopeId: s, userId: u, role: 'viewer' })
        ),
        'E_ACCESS_CONTROL_INVALID_INPUT'
      )
      assert.isNull(await failing.memberships.find(s, u))
    } finally {
      await failing.cleanup()
    }
  })

  test('find and listForUser read without an actor', async ({ assert }) => {
    const other = await f.createScope()
    await f.memberships.createFirstMember({ scopeId: other, userId: viewer })
    const list = await f.memberships.listForUser(viewer)
    assert.deepEqual(
      list.map((m) => [m.scopeId, m.role]),
      [
        [scope, 'viewer'],
        [other, 'owner'],
      ]
    )
    assert.isNull(await f.memberships.find(scope, outsider))
    assert.deepEqual(await f.memberships.listForUser(outsider), [])
    assert.equal(await codeOf(f.memberships.find(scope, 'x')), 'E_ACCESS_CONTROL_INVALID_INPUT')
  })

  test('listForScope: pages in created_at, id order and needs members:list', async ({ assert }) => {
    const page = await f.memberships.listForScope({ actor: actor(admin), scopeId: scope, limit: 3 })
    assert.deepEqual(
      page.items.map((m) => m.userId),
      [owner, admin, editor]
    )
    assert.isString(page.nextCursor)
    const rest = await f.memberships.listForScope({
      actor: actor(admin),
      scopeId: scope,
      limit: 3,
      cursor: page.nextCursor!,
    })
    assert.deepEqual(
      rest.items.map((m) => m.userId),
      [viewer]
    )
    assert.isNull(rest.nextCursor)
    assert.equal(
      await codeOf(f.memberships.listForScope({ actor: actor(editor), scopeId: scope })),
      'E_ACCESS_CONTROL_FORBIDDEN'
    )
    assert.equal(
      await codeOf(f.memberships.listForScope({ actor: actor(outsider), scopeId: scope })),
      'E_ACCESS_CONTROL_FORBIDDEN'
    )
    assert.equal(
      await codeOf(f.memberships.listForScope({ actor: actor(admin), scopeId: scope, limit: 0 })),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    assert.equal(
      await codeOf(f.memberships.listForScope({ actor: actor(admin), scopeId: scope, limit: 101 })),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    assert.equal(
      await codeOf(
        f.memberships.listForScope({ actor: actor(admin), scopeId: scope, cursor: 'nope' })
      ),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
  })

  test('listForScope: cursor paging across equal created_at', async ({ assert }) => {
    const at = (await f.memberships.find(scope, owner))!.createdAt
    await f.db
      .from(f.names.memberships)
      .where('scope_id', scope)
      .update({ created_at: f.runner.sqlTimestamp(f.db.connection(), at) })
    const seen: Array<number | string> = []
    let cursor: string | null = null
    for (let i = 0; i < 10; i++) {
      const page = await f.memberships.listForScope({
        actor: actor(admin),
        scopeId: scope,
        limit: 1,
        cursor: cursor ?? undefined,
      })
      seen.push(...page.items.map((m) => m.userId))
      cursor = page.nextCursor
      if (!cursor) break
    }
    assert.deepEqual(seen, [owner, admin, editor, viewer])
  })

  test('a caller-supplied trx is used and rolls back with the caller', async ({ assert }) => {
    await f.runner
      .transaction(f.db, async (trx) => {
        await f.memberships.add({
          actor: actor(admin),
          scopeId: scope,
          userId: outsider,
          role: 'viewer',
          trx,
        })
        assert.deepInclude(await f.memberships.find(scope, outsider, trx), { role: 'viewer' })
        throw new AccessControlError('E_ACCESS_CONTROL_CONFLICT')
      })
      .catch(() => {})
    assert.isNull(await f.memberships.find(scope, outsider))
    assert.lengthOf(f.events, 1)
  })
})
