import { test } from '@japa/runner'
import { codeOf, membershipFixture, type MembershipFixture } from './helpers/fixture.js'

const actor = (id: number | string) => ({ id })

test.group('memberships: concurrent operations serialise on the locks (spec 4.2)', (group) => {
  let f: MembershipFixture
  group.each.setup(async () => {
    f = await membershipFixture()
    return () => f.cleanup()
  })

  test('concurrent createFirstMember on an empty scope: exactly one succeeds', async ({
    assert,
  }) => {
    const s = await f.createScope()
    const [a, b] = await Promise.all([f.createUser(), f.createUser()])
    const outcomes = await Promise.all([
      codeOf(f.memberships.createFirstMember({ scopeId: s, userId: a })),
      codeOf(f.memberships.createFirstMember({ scopeId: s, userId: b })),
    ])
    assert.sameMembers(outcomes, ['resolved', 'E_ACCESS_CONTROL_SCOPE_NOT_EMPTY'])
    assert.lengthOf(await f.rows(s), 1)
    assert.lengthOf(f.events, 1)
  })

  test('concurrent remove of two admins by each other: at most one succeeds', async ({
    assert,
  }) => {
    const s = await f.createScope()
    const [o, a, b] = await Promise.all([f.createUser(), f.createUser(), f.createUser()])
    await f.memberships.createFirstMember({ scopeId: s, userId: o })
    await f.memberships.add({ actor: actor(o), scopeId: s, userId: a, role: 'admin' })
    await f.memberships.add({ actor: actor(o), scopeId: s, userId: b, role: 'admin' })
    const outcomes = await Promise.all([
      codeOf(f.memberships.remove({ actor: actor(a), scopeId: s, userId: b })),
      codeOf(f.memberships.remove({ actor: actor(b), scopeId: s, userId: a })),
    ])
    assert.lengthOf(
      outcomes.filter((outcome) => outcome === 'resolved'),
      1
    )
    assert.include(outcomes, 'E_ACCESS_CONTROL_FORBIDDEN')
    assert.lengthOf(await f.rows(s), 2)
  })

  test('concurrent transferOwnership twice, and transfer versus remove: one active owner remains', async ({
    assert,
  }) => {
    const s = await f.createScope()
    const [o, a, b] = await Promise.all([f.createUser(), f.createUser(), f.createUser()])
    await f.memberships.createFirstMember({ scopeId: s, userId: o })
    await f.memberships.add({ actor: actor(o), scopeId: s, userId: a, role: 'admin' })
    await f.memberships.add({ actor: actor(o), scopeId: s, userId: b, role: 'admin' })
    const twice = await Promise.all([
      codeOf(f.memberships.transferOwnership({ actor: actor(o), scopeId: s, toUserId: a })),
      codeOf(f.memberships.transferOwnership({ actor: actor(o), scopeId: s, toUserId: b })),
    ])
    assert.sameMembers(twice, ['resolved', 'E_ACCESS_CONTROL_FORBIDDEN'])
    const owners = async () => f.rows(s).where({ role: 'owner', status: 'active' })
    assert.lengthOf(await owners(), 1)
    const [ownerRow] = await owners()
    const newOwner = ownerRow.user_id
    const other = newOwner === a ? b : a
    const versus = await Promise.all([
      codeOf(
        f.memberships.transferOwnership({ actor: actor(newOwner), scopeId: s, toUserId: other })
      ),
      codeOf(f.memberships.remove({ actor: actor(newOwner), scopeId: s, userId: other })),
    ])
    assert.include(versus, 'resolved')
    assert.lengthOf(await owners(), 1)
    const rows = await f.rows(s)
    assert.isTrue(rows.every((row) => ['owner', 'admin'].includes(row.role)))
  })
})
