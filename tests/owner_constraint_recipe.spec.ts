import { test } from '@japa/runner'
import { testEngine } from './helpers/database.ts'
import { membershipFixture } from './helpers/fixture.ts'
import { sqlTimestamp } from '../src/kit_transaction.ts'

// #region active_owner_constraint
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class AddActiveOwnerConstraint extends BaseSchema {
  async up() {
    this.schema.raw(
      "CREATE UNIQUE INDEX memberships_one_active_owner ON memberships (scope_id) WHERE status = 'active' AND role = 'owner'"
    )
  }

  async down() {
    this.schema.raw('DROP INDEX memberships_one_active_owner')
  }
}
// #endregion active_owner_constraint

if (testEngine === 'sqlite') {
  test('the optional owner index rejects dirty rows, preserves transfer and can roll back', async ({
    assert,
  }) => {
    const f = await membershipFixture({ membershipsTable: 'memberships' })
    try {
      const migration = () => new AddActiveOwnerConstraint(f.db.connection(), 'single-owner', false)
      const [scopeId, otherScopeId] = await Promise.all([f.createScope(), f.createScope()])
      const [owner, incoming, other] = await Promise.all([
        f.createUser(),
        f.createUser(),
        f.createUser(),
      ])
      await f.memberships.createFirstMember({ scopeId, userId: owner })
      await f.memberships.createFirstMember({ scopeId: otherScopeId, userId: other })
      const addDuplicate = async () => {
        const timestamp = sqlTimestamp(f.db)
        return f.db.table(f.names.memberships).insert({
          scope_id: scopeId,
          user_id: incoming,
          role: 'owner',
          status: 'active',
          created_at: timestamp,
          updated_at: timestamp,
        })
      }
      await addDuplicate()
      await assert.rejects(() => migration().execUp(), /UNIQUE constraint failed/)
      await f.db
        .from(f.names.memberships)
        .where('scope_id', scopeId)
        .where('user_id', incoming)
        .delete()
      await migration().execUp()
      await assert.rejects(addDuplicate, /UNIQUE constraint failed/)
      await f.memberships.add({ actor: { id: owner }, scopeId, userId: incoming, role: 'admin' })
      await f.memberships.transferOwnership({ actor: { id: owner }, scopeId, toUserId: incoming })
      const nextOwner = await f.memberships.find(scopeId, incoming)
      const previousOwner = await f.memberships.find(scopeId, owner)
      const separateOwner = await f.memberships.find(otherScopeId, other)
      assert.equal(nextOwner?.role, 'owner')
      assert.equal(previousOwner?.role, 'admin')
      assert.equal(separateOwner?.role, 'owner')
      await migration().execDown()
      await f.db
        .from(f.names.memberships)
        .where('scope_id', scopeId)
        .where('user_id', owner)
        .update({ role: 'owner' })
    } finally {
      await f.cleanup()
    }
  })
}
