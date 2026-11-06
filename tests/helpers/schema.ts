// Creates the kit's lock row, a users table, a scope table and the package's memberships table.
import { testEngine } from './database.js'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { Database } from '@adonisjs/lucid/database'
import type { BaseSchema } from '@adonisjs/lucid/schema'
import { membershipsMigrationSchema } from '../../src/migration_schema.js'
import type { KeyType } from '../../src/types.js'

export interface SchemaNames {
  users: string
  scope: string
  memberships: string
}

export const LOCK_TABLE = 'account_transaction_lock'

/** The kit's `account_transaction_lock` table with row id 1, version 0; shared on MySQL. */
export async function createLockRow(db: Database): Promise<void> {
  const schema = db.connection().schema
  if (!(await schema.hasTable(LOCK_TABLE)))
    await schema.createTable(LOCK_TABLE, (table) => {
      table.integer('id').primary()
      table.integer('version').notNullable().defaultTo(0)
    })
  const row = await db.from(LOCK_TABLE).where('id', 1).first()
  if (!row) await db.table(LOCK_TABLE).insert({ id: 1, version: 0 })
}

/** A parent table with an `id` primary key of the given key type and a `name` column. */
export async function createParentTable(
  db: Database,
  name: string,
  keyType: KeyType,
  options: { caseInsensitiveKeys?: boolean } = {}
) {
  if (keyType === 'string' && options.caseInsensitiveKeys && testEngine === 'sqlite') {
    // Knex drops `collate` on SQLite, so the case-insensitive key table is raw DDL.
    await db.rawQuery(
      `create table \`${name}\` (\`id\` varchar(254) collate nocase primary key, \`name\` varchar(100) not null)`
    )
    return
  }
  await db.connection().schema.createTable(name, (table) => {
    if (keyType === 'integer') table.increments('id')
    else if (keyType === 'uuid') table.uuid('id').primary()
    else table.string('id', 254).primary()
    table.string('name', 100).notNullable()
  })
}

const stubPath = new URL(
  '../../stubs/migrations/access_control_create_memberships.stub',
  import.meta.url
)

/** Renders the migration stub the way `configure` will, for a given set of names and key types. */
export async function renderMembershipsStub(input: {
  membershipsTable: string
  usersTable: string
  userKeyType: KeyType
  scopeTable: string
  scopeKeyType: KeyType
}): Promise<string> {
  const data: Record<string, string> = { ...membershipsMigrationSchema(input) }
  const stub = await readFile(stubPath, 'utf8')
  return stub
    .replace(/^\{\{\{ exports\(.*\) \}\}\}\n\n/, '')
    .replace(/\{\{\{\s*(\w+)\s*\}\}\}|\{\{\s*(\w+)\s*\}\}/g, (_, raw, escaped) => {
      const key = raw ?? escaped
      if (!(key in data)) throw new Error(`stub placeholder ${key} has no value`)
      return data[key]
    })
}

/** Runs the rendered stub as a Lucid migration against the database. */
export async function runMembershipsMigration(
  db: Database,
  input: Parameters<typeof renderMembershipsStub>[0],
  direction: 'up' | 'down' = 'up'
): Promise<void> {
  // Under the repository so the migration resolves `@adonisjs/lucid` from node_modules.
  const tmp = fileURLToPath(new URL('../../tmp/', import.meta.url))
  await mkdir(tmp, { recursive: true })
  const directory = await mkdtemp(join(tmp, 'migration_'))
  const file = join(directory, `${randomUUID()}.ts`)
  try {
    await writeFile(file, await renderMembershipsStub(input))
    const module = (await import(`file://${file}`)) as {
      default: new (db: unknown, file: string, dryRun: boolean) => BaseSchema
    }
    const migration = new module.default(db.connection(), file, false)
    if (direction === 'up') await migration.execUp()
    else await migration.execDown()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Lock row, users table, scope table and the memberships table from the stub. */
export async function createSchema(
  db: Database,
  names: SchemaNames,
  keyTypes: { users: KeyType; scope: KeyType },
  options: { caseInsensitiveKeys?: boolean } = {}
): Promise<void> {
  await createLockRow(db)
  await createParentTable(db, names.users, keyTypes.users, options)
  await createParentTable(db, names.scope, keyTypes.scope, options)
  await runMembershipsMigration(db, {
    membershipsTable: names.memberships,
    usersTable: names.users,
    userKeyType: keyTypes.users,
    scopeTable: names.scope,
    scopeKeyType: keyTypes.scope,
  })
}

/** Drops the fixture's tables, children first. The lock table stays for the next fixture. */
export async function dropSchema(db: Database, names: SchemaNames): Promise<void> {
  const schema = db.connection().schema
  await schema.dropTableIfExists(names.memberships)
  await schema.dropTableIfExists(names.scope)
  await schema.dropTableIfExists(names.users)
}
