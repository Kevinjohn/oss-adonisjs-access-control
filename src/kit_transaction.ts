// The transaction runner (specification 0.2): Account Kit's export when the installed kit has it,
// otherwise a local runner with the same contract that shares the kit's SQLite lock row.
import type { Database } from '@adonisjs/lucid/database'
import { DateTime } from 'luxon'
import { AccessControlError } from './errors.js'
import type { DialectSource, TransactionRunner, Trx } from './types.js'

/** The runner contract, as `@kevinjohn/adonisjs-account-kit/transaction` exports it. */
export type KitRunner = TransactionRunner

const KIT_TRANSACTION_MODULE: string = '@kevinjohn/adonisjs-account-kit/transaction'
const LOCK_TABLE = 'account_transaction_lock'
const SQLITE_RETRY_MS = 10
const SQLITE_DEADLINE_MS = 5000
const runnerFunctions = ['transaction', 'lockRow', 'sqlTimestamp', 'readTimestamp'] as const

function invalidConfig(detail: string, cause?: unknown): AccessControlError {
  return new AccessControlError('E_ACCESS_CONTROL_INVALID_CONFIG', {
    message: `access-control: ${detail}`,
    cause,
  })
}

function dialectOf(client: DialectSource): string {
  return 'dialect' in client ? client.dialect.name : client.connection().dialect.name
}

/** UTC wall time for MySQL, which rejects ISO 8601 offsets; ISO 8601 elsewhere. */
export function sqlTimestamp(client: DialectSource, at: DateTime = DateTime.utc()): string {
  const utc = at.toUTC()
  if (!utc.isValid)
    throw new AccessControlError('E_ACCESS_CONTROL_INVALID_INPUT', {
      message: 'access-control: invalid timestamp',
    })
  return dialectOf(client) === 'mysql' ? utc.toFormat('yyyy-MM-dd HH:mm:ss.SSS') : utc.toISO()!
}

/** A timestamp column as the driver returns it: a Date, an ISO or SQL string, or epoch milliseconds. */
export function readTimestamp(value: unknown): DateTime | null {
  if (value === null || value === undefined) return null
  let parsed: DateTime | undefined
  if (value instanceof Date) parsed = DateTime.fromJSDate(value, { zone: 'utc' })
  else if (typeof value === 'number') parsed = DateTime.fromMillis(value, { zone: 'utc' })
  else if (typeof value === 'string') {
    parsed = DateTime.fromISO(value, { zone: 'utc' })
    if (!parsed.isValid) parsed = DateTime.fromSQL(value, { zone: 'utc' })
  }
  if (!parsed?.isValid)
    throw new AccessControlError('E_ACCESS_CONTROL_INVALID_INPUT', {
      message: 'access-control: unreadable timestamp value',
    })
  return parsed
}

/** SQLite serialises writers through the lock row; PostgreSQL and MySQL lock the physical row. */
export async function lockRow(trx: Trx, table: string, id: number | string): Promise<void> {
  if (trx.dialect.name === 'better-sqlite3') return
  await trx.from(table).select('id').where('id', id).forUpdate().first()
}

function isBusy(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_SNAPSHOT'
}

async function runAndCommit<T>(trx: Trx, callback: (trx: Trx) => Promise<T>): Promise<T> {
  try {
    const result = await callback(trx)
    await trx.commit()
    return result
  } catch (error) {
    if (!trx.isCompleted) await trx.rollback()
    throw error
  }
}

/**
 * Timestamps are written as UTC wall time; mysql2's default `timezone: 'local'` would shift
 * every value read back by the host's offset.
 */
function requireUtcMysql(db: Database): void {
  const config = db.manager.get(db.primaryConnectionName)?.config
  const timezone = (config?.connection as { timezone?: string } | undefined)?.timezone
  if (timezone === 'Z' || timezone === '+00:00') return
  throw invalidConfig(
    `the MySQL connection must set timezone: 'Z' (found ${JSON.stringify(timezone ?? 'local')})`
  )
}

/** Touches the kit's lock row; a missing table or row is a configuration error. */
async function touchLockRow(trx: Trx): Promise<void> {
  let affected: unknown
  try {
    affected = await trx
      .from(LOCK_TABLE)
      .where('id', 1)
      .update({ version: trx.raw('version') })
  } catch (error) {
    if (isBusy(error)) throw error
    throw invalidConfig(
      `the ${LOCK_TABLE} table with row id 1 is required; run the Account Kit migrations`,
      error
    )
  }
  if (affected !== 1)
    throw invalidConfig(
      `the ${LOCK_TABLE} table has no row with id 1; run the Account Kit migrations`
    )
}

/**
 * Takes SQLite's write lock as the transaction's first statement, with the busy handler off so a
 * held lock fails at once instead of waiting inside SQLite, where a connection that already holds
 * a shared lock is never retried. The connection's busy timeout is restored before anything else.
 */
async function acquireWriteLock(trx: Trx): Promise<void> {
  const [{ timeout }] = (await trx.rawQuery('pragma busy_timeout').exec()) as [{ timeout: unknown }]
  await trx.rawQuery('pragma busy_timeout = 0').exec()
  try {
    await touchLockRow(trx)
  } finally {
    await trx.rawQuery(`pragma busy_timeout = ${Number(timeout)}`).exec()
  }
}

/** One transaction per attempt; a busy write lock is retried until the deadline. */
async function sqliteTransaction<T>(db: Database, callback: (trx: Trx) => Promise<T>): Promise<T> {
  const deadline = performance.now() + SQLITE_DEADLINE_MS
  for (;;) {
    const trx = await db.transaction()
    try {
      await acquireWriteLock(trx)
    } catch (error) {
      await trx.rollback()
      if (!isBusy(error) || performance.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, SQLITE_RETRY_MS))
      continue
    }
    return runAndCommit(trx, callback)
  }
}

/** Runs a database-only callback in its own transaction, committing when it resolves. */
export async function transaction<T>(db: Database, callback: (trx: Trx) => Promise<T>): Promise<T> {
  const dialect = db.connection().dialect.name
  if (dialect === 'better-sqlite3') return sqliteTransaction(db, callback)
  if (dialect === 'mysql') {
    requireUtcMysql(db)
    // Lucid forwards options only from the second argument; the options-only overload drops them.
    const trx = (await db.transaction(undefined as never, {
      isolationLevel: 'read committed',
    })) as Trx
    return runAndCommit(trx, callback)
  }
  return runAndCommit(await db.transaction(), callback)
}

const localRunner: KitRunner = Object.freeze({
  source: 'local',
  transaction,
  lockRow,
  sqlTimestamp,
  readTimestamp,
})

function isMissingModule(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || code === 'ERR_MODULE_NOT_FOUND'
}

let loaded: Promise<KitRunner> | undefined

async function resolveRunner(): Promise<KitRunner> {
  try {
    const kit = (await import(KIT_TRANSACTION_MODULE)) as Partial<Record<string, unknown>>
    if (runnerFunctions.every((name) => typeof kit[name] === 'function'))
      return Object.freeze({
        source: 'account-kit',
        transaction: kit.transaction as KitRunner['transaction'],
        lockRow: kit.lockRow as KitRunner['lockRow'],
        sqlTimestamp: kit.sqlTimestamp as KitRunner['sqlTimestamp'],
        readTimestamp: kit.readTimestamp as KitRunner['readTimestamp'],
      })
  } catch (error) {
    if (!isMissingModule(error)) throw error
  }
  return localRunner
}

/**
 * The runner the provider attaches: Account Kit's `transaction` export when the installed kit
 * ships it (#769), otherwise the local runner. Resolved once per process.
 */
export function loadRunner(): Promise<KitRunner> {
  loaded ??= resolveRunner()
  return loaded
}
