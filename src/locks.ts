// The lock process (specification 4.2): user rows ascending, then scope rows ascending.
import { AccessControlError } from './errors.js'
import type { ScopeKey, TransactionRunner, Trx, UserKey } from './types.js'

/** Unique keys in code-unit order of `String(key)`, so integer keys sort as strings. */
export function ascending<K extends ScopeKey | UserKey>(keys: Iterable<K>): K[] {
  const byString = new Map<string, K>()
  for (const key of keys) byString.set(String(key), key)
  return [...byString.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, key]) => key)
}

/** Locks the given user rows, ascending. A missing user row locks nothing. */
export async function lockUsers(
  runner: TransactionRunner,
  trx: Trx,
  table: string,
  ids: Iterable<UserKey>
): Promise<void> {
  for (const id of ascending(ids)) await runner.lockRow(trx, table, id)
}

/** Locks one scope row and proves it exists; otherwise `SCOPE_NOT_FOUND`. */
export async function lockScope(
  runner: TransactionRunner,
  trx: Trx,
  table: string,
  id: ScopeKey
): Promise<void> {
  await runner.lockRow(trx, table, id)
  const row = await trx.from(table).select('id').where('id', id).first()
  if (row === undefined || row === null)
    throw new AccessControlError('E_ACCESS_CONTROL_SCOPE_NOT_FOUND')
}

/** Locks several scope rows, ascending. */
export async function lockScopes(
  runner: TransactionRunner,
  trx: Trx,
  table: string,
  ids: Iterable<ScopeKey>
): Promise<void> {
  for (const id of ascending(ids)) await lockScope(runner, trx, table, id)
}
