// The membership service over a fresh schema on the client under test.
import { randomUUID } from 'node:crypto'
import { defineAccessControl } from '../../index.js'
import { loadRunner } from '../../src/kit_transaction.js'
import type { KitRunner } from '../../src/kit_transaction.js'
import type { KeyType, MembershipEvent, ScopeKey, Trx, UserKey } from '../../src/types.js'
import { testDatabase, type TestDatabase } from './database.js'
import { createSchema, dropSchema, type SchemaNames } from './schema.js'

export const roles = ['viewer', 'editor', 'admin', 'owner'] as const
export type Role = (typeof roles)[number]

export const permissions = {
  project: { read: 'viewer', write: 'editor', archive: 'admin' },
  members: { list: 'admin', manage: 'admin' },
  invitations: { manage: 'admin' },
} as const

export interface FixtureOptions {
  keyType?: KeyType
  scopeKeyType?: KeyType
  /** Default true. */
  owner?: boolean
  membershipsTable?: string
  sqliteBusyTimeout?: number
  /** String keys compared case-insensitively: SQLite `NOCASE`; MySQL's default collation already is. */
  caseInsensitiveKeys?: boolean
  onMembershipChanged?: (event: MembershipEvent<Role>, trx: Trx) => Promise<void>
}

let counter = 0

export async function membershipFixture(options: FixtureOptions = {}) {
  const database: TestDatabase = await testDatabase({
    sqliteBusyTimeout: options.sqliteBusyTimeout,
  })
  const userKeyType = options.keyType ?? 'integer'
  const scopeKeyType = options.scopeKeyType ?? userKeyType
  const names: SchemaNames = {
    users: `users_${database.suffix}`,
    scope: `teams_${database.suffix}`,
    memberships: options.membershipsTable ?? `memberships_${database.suffix}`,
  }
  try {
    await createSchema(
      database.db,
      names,
      { users: userKeyType, scope: scopeKeyType },
      { caseInsensitiveKeys: options.caseInsensitiveKeys }
    )
  } catch (error) {
    await database.cleanup()
    throw error
  }
  const events: MembershipEvent<Role>[] = []
  const config = defineAccessControl({
    roles: [...roles],
    ...(options.owner === false ? {} : { ownerRole: 'owner' }),
    users: { table: names.users, keyType: userKeyType },
    scope: { table: names.scope, keyType: scopeKeyType },
    membershipsTable: names.memberships,
    permissions,
    async onMembershipChanged(event, trx) {
      events.push(event)
      await options.onMembershipChanged?.(event, trx)
    },
  })
  const runner: KitRunner = await loadRunner()
  config.attach(database.db, runner)

  async function createRow(table: string, keyType: KeyType): Promise<number | string> {
    counter += 1
    const name = `row ${counter}`
    if (keyType === 'integer') {
      // PostgreSQL returns `[{ id }]` for `returning`; SQLite and MySQL return `[id]`.
      const [inserted] = await database.db.table(table).returning('id').insert({ name })
      return Number(typeof inserted === 'object' ? inserted.id : inserted)
    }
    const id = keyType === 'uuid' ? randomUUID() : `key_${counter}`
    await database.db.table(table).insert({ id, name })
    return id
  }

  return {
    db: database.db,
    engine: database.engine,
    /** Whether the parent tables compare string keys case-insensitively on this engine. */
    caseInsensitiveKeys: options.caseInsensitiveKeys === true && database.engine !== 'pg',
    names,
    config,
    memberships: config.memberships,
    events,
    runner,
    createUser: (): Promise<UserKey> => createRow(names.users, userKeyType),
    createScope: (): Promise<ScopeKey> => createRow(names.scope, scopeKeyType),
    /** Every membership row of a scope, raw, by id. */
    rows: (scopeId: ScopeKey) =>
      database.db.from(names.memberships).where('scope_id', scopeId).orderBy('id', 'asc'),
    async cleanup() {
      try {
        await dropSchema(database.db, names)
      } finally {
        await database.cleanup()
      }
    },
  }
}

export type MembershipFixture = Awaited<ReturnType<typeof membershipFixture>>

/** The `E_ACCESS_CONTROL_*` code of a rejected promise, or 'resolved'. */
export async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'resolved'
  } catch (error) {
    return (error as { code?: string }).code ?? String(error)
  }
}
