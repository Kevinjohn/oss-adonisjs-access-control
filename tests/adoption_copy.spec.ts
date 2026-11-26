import { test } from '@japa/runner'
import { copyMemberships } from '../examples/adopting/copy_memberships.ts'
import { membershipFixture } from './helpers/fixture.ts'

test('the adoption copy remains visible through every cursor page', async ({ assert }) => {
  const f = await membershipFixture()
  const source = `old_memberships_${f.names.memberships}`
  try {
    await f.db.connection().schema.createTable(source, (table) => {
      table.integer('team_id').notNullable()
      table.integer('user_id').notNullable()
      table.string('role').notNullable()
      table.boolean('disabled').notNullable()
    })
    const scope = await f.createScope()
    const users = await Promise.all(Array.from({ length: 4 }, () => f.createUser()))
    for (const [index, user] of users.entries()) {
      await f.db.table(source).insert({
        team_id: scope,
        user_id: user,
        role: index === 0 ? 'owner' : index === 1 ? 'manager' : 'viewer',
        disabled: index === 3,
      })
    }
    await copyMemberships(f.db, source, f.names.memberships)

    const seen: Array<number | string> = []
    let cursor: string | null = null
    for (let pageNumber = 0; pageNumber < users.length + 1; pageNumber++) {
      const page = await f.memberships.listForScope({
        actor: { id: users[0] },
        scopeId: scope,
        limit: 1,
        cursor: cursor ?? undefined,
      })
      seen.push(...page.items.map((member) => member.userId))
      cursor = page.nextCursor
      if (cursor === null) break
    }
    assert.deepEqual(seen, users)
    assert.isNull(cursor)
    const mappedAdmin = await f.memberships.find(scope, users[1])
    const suspendedMember = await f.memberships.find(scope, users[3])
    assert.equal(mappedAdmin?.role, 'admin')
    assert.equal(suspendedMember?.status, 'suspended')
  } finally {
    await f.db.connection().schema.dropTableIfExists(source)
    await f.cleanup()
  }
})
