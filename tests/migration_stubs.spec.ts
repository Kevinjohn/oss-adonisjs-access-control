import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import { membershipsMigrationSchema } from '../src/migration_schema.js'
import { renderMembershipsStub } from './helpers/schema.js'

const directory = new URL('../stubs/migrations/', import.meta.url)

test.group('migration stubs: released stubs are immutable (spec 17.1)', () => {
  test('every released stub exists with its recorded sha256', async ({ assert }) => {
    const released = JSON.parse(
      await readFile(new URL('released.json', directory), 'utf8')
    ) as Array<{
      name: string
      sha256: string
    }>
    assert.isNotEmpty(released)
    for (const { name, sha256 } of released) {
      const content = await readFile(new URL(`${name}.stub`, directory))
      assert.equal(createHash('sha256').update(content).digest('hex'), sha256, name)
    }
    const files = await readdir(directory)
    const stubs = files
      .filter((file) => file.endsWith('.stub'))
      .map((f) => f.replace(/\.stub$/, ''))
    assert.includeMembers(
      stubs,
      released.map((r) => r.name)
    )
    assert.include(
      released.map((r) => r.name),
      'create_memberships'
    )
  })

  test('the memberships stub renders the configured names and key columns', async ({ assert }) => {
    const rendered = await renderMembershipsStub({
      membershipsTable: 'team_members',
      usersTable: 'accounts',
      userKeyType: 'uuid',
      scopeTable: 'teams',
      scopeKeyType: 'string',
    })
    assert.include(rendered, "protected tableName = 'team_members'")
    assert.include(rendered, "table.string('scope_id', 254)")
    assert.include(rendered, "table.uuid('user_id')")
    assert.include(rendered, ".inTable('teams')")
    assert.include(rendered, ".inTable('accounts')")
    assert.include(rendered, ".onDelete('RESTRICT')")
    assert.include(rendered, "indexName: 'team_members_scope_user_unique'")
    assert.notInclude(rendered, '{{')
    assert.notInclude(rendered, 'exports(')
    assert.include(
      await renderMembershipsStub({
        membershipsTable: 'm',
        usersTable: 'u',
        userKeyType: 'integer',
        scopeTable: 's',
        scopeKeyType: 'integer',
      }),
      "table.integer('scope_id').unsigned()"
    )
  })

  test('the migration schema rejects bad identifiers and key types', ({ assert }) => {
    const valid = {
      membershipsTable: 'memberships',
      usersTable: 'users',
      userKeyType: 'integer',
      scopeTable: 'teams',
      scopeKeyType: 'integer',
    } as const
    assert.deepEqual(membershipsMigrationSchema(valid), {
      membershipsTable: 'memberships',
      usersTable: 'users',
      scopeTable: 'teams',
      scopeIdColumn: "table.integer('scope_id').unsigned()",
      userIdColumn: "table.integer('user_id').unsigned()",
    })
    assert.throws(
      () => membershipsMigrationSchema({ ...valid, membershipsTable: 'bad;name' }),
      /membershipsTable/
    )
    assert.throws(() => membershipsMigrationSchema({ ...valid, usersTable: '' }), /usersTable/)
    assert.throws(() => membershipsMigrationSchema({ ...valid, scopeTable: 'a.b' }), /scopeTable/)
    assert.throws(
      () => membershipsMigrationSchema({ ...valid, userKeyType: 'bigint' as never }),
      /userKeyType/
    )
    assert.throws(
      () => membershipsMigrationSchema({ ...valid, scopeKeyType: 'number' as never }),
      /scopeKeyType/
    )
  })
})
