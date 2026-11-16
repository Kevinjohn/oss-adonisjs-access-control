import { test } from '@japa/runner'
import { membershipFixture } from './helpers/fixture.js'

test('cleanup hooks receive historical stored role strings', async ({ assert }) => {
  const seen: string[] = []
  const fixture = await membershipFixture({
    async onMembershipChanged(event) {
      if (event.type === 'membership.left' || event.type === 'membership.removed') {
        seen.push(event.role)
      }
    },
  })
  try {
    const scopeId = await fixture.createScope()
    const ownerId = await fixture.createUser()
    const memberId = await fixture.createUser()
    await fixture.memberships.createFirstMember({ scopeId, userId: ownerId })
    await fixture.memberships.add({
      actor: { id: ownerId },
      scopeId,
      userId: memberId,
      role: 'viewer',
    })
    await fixture.db
      .from(fixture.names.memberships)
      .where({ scope_id: scopeId, user_id: memberId })
      .update({ role: 'retired' })
    await fixture.memberships.leave({ scopeId, userId: memberId })
    assert.deepEqual(seen, ['retired'])
    assert.isNull(await fixture.memberships.find(scopeId, memberId))
  } finally {
    await fixture.cleanup()
  }
})
