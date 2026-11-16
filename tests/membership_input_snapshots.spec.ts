import { test } from '@japa/runner'
import { membershipFixture } from './helpers/fixture.js'
import type { Trx } from '../src/types.js'

for (const operation of ['add', 'changeRole', 'setStatus', 'grant', 'acceptInvitation'] as const) {
  test(`${operation} keeps validated input and event values after input reuse`, async ({
    assert,
  }) => {
    const f = await membershipFixture()
    try {
      const scopeId = await f.createScope()
      const owner = await f.createUser()
      const target = await f.createUser()
      await f.memberships.createFirstMember({ scopeId, userId: owner })
      if (operation === 'changeRole' || operation === 'setStatus') {
        await f.memberships.add({ actor: { id: owner }, scopeId, userId: target, role: 'viewer' })
      }
      f.events.length = 0
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let gated = false
      f.config.attach(f.db, {
        ...f.runner,
        async lockRow(trx, table, id) {
          if (!gated && table === f.names.scope) {
            gated = true
            entered.resolve()
            await release.promise
          }
          return f.runner.lockRow(trx, table, id)
        },
      })
      const input = {
        actor: { id: owner },
        scopeId,
        userId: target,
        role: 'editor',
        status: 'suspended' as 'active' | 'suspended',
        invitationId: 77,
        trx: undefined as Trx | undefined,
      }
      const write =
        operation === 'add'
          ? f.config.memberships.add(input)
          : operation === 'changeRole'
            ? f.config.memberships.changeRole(input)
            : operation === 'setStatus'
              ? f.config.memberships.setStatus(input)
              : f.runner.transaction(f.db, (trx) => {
                  input.trx = trx
                  return operation === 'grant'
                    ? f.config.memberships.grant(input as typeof input & { trx: Trx })
                    : f.config.memberships.acceptInvitation(input as typeof input & { trx: Trx })
                })
      await entered.promise
      input.role = 'owner'
      input.status = 'unknown' as never
      input.invitationId = 88
      release.resolve()
      const membership = await write
      assert.equal(membership.role, operation === 'setStatus' ? 'viewer' : 'editor', operation)
      assert.equal(membership.status, operation === 'setStatus' ? 'suspended' : 'active', operation)
      const stored = await f.config.memberships.find(scopeId, target)
      assert.equal(stored?.role, membership.role, operation)
      assert.equal(stored?.status, membership.status, operation)
      const [event] = f.events
      assert.isDefined(event, operation)
      if ('role' in event) assert.equal(event.role, membership.role, operation)
      if ('to' in event)
        assert.equal(
          event.to,
          operation === 'setStatus' ? membership.status : membership.role,
          operation
        )
      if ('invitationId' in event) assert.equal(event.invitationId, 77)
    } finally {
      await f.cleanup()
    }
  })
}

test('acceptInvitation captures the recipient before its first parent lookup', async ({
  assert,
}) => {
  const f = await membershipFixture({ scopeKeyType: 'string' })
  try {
    const scopeId = await f.createScope()
    const original = await f.createUser()
    const replacement = await f.createUser()
    await f.runner.transaction(f.db, async (trx) => {
      const input = { scopeId, userId: original, role: 'editor', invitationId: 55, trx }
      const pending = f.memberships.acceptInvitation(input)
      input.userId = replacement
      const membership = await pending
      assert.equal(membership.userId, original)
    })
    const storedOriginal = await f.memberships.find(scopeId, original)
    assert.equal(storedOriginal?.role, 'editor')
    assert.isNull(await f.memberships.find(scopeId, replacement))
    assert.deepInclude(f.events[0], {
      type: 'membership.invitation_accepted',
      scopeId,
      userId: original,
      role: 'editor',
      invitationId: 55,
    })
  } finally {
    await f.cleanup()
  }
})
