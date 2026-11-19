// The lock process (specification 4.2): user rows ascending, then scope rows ascending.
import { AccessControlError } from './errors.js'
import type { ScopeKey, TransactionRunner, Trx, UserKey } from './types.js'

/** Unique keys in code-unit order of `String(key)`, so integer keys sort as strings. */
export function ascending<K extends ScopeKey | UserKey>(keys: Iterable<K>): K[] {
  const keysByText = new Map<string, K>()
  for (const key of keys) keysByText.set(String(key), key)
  return [...keysByText.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, key]) => key)
}

/** Whether two key lists hold the same set of keys, compared element by element. */
export function sameKeys<K extends ScopeKey | UserKey>(a: Iterable<K>, b: Iterable<K>): boolean {
  const left = ascending(a).map(String)
  const right = ascending(b).map(String)
  return left.length === right.length && left.every((key, index) => key === right[index])
}

/** Locks the given user rows, ascending. A missing user row locks nothing. */
export async function lockUsers(
  runner: TransactionRunner,
  trx: Trx,
  { usersTable, userIds }: { usersTable: string; userIds: Iterable<UserKey> }
): Promise<void> {
  for (const userId of ascending(userIds)) await runner.lockRow(trx, usersTable, userId)
}

/** Locks one scope row and proves it exists; otherwise `SCOPE_NOT_FOUND`. */
export async function lockScope(
  runner: TransactionRunner,
  trx: Trx,
  { scopeTable, scopeId }: { scopeTable: string; scopeId: ScopeKey }
): Promise<void> {
  await runner.lockRow(trx, scopeTable, scopeId)
  const row = await trx.from(scopeTable).select('id').where('id', scopeId).first()
  if (row === undefined || row === null)
    throw new AccessControlError('E_ACCESS_CONTROL_SCOPE_NOT_FOUND')
}

/** Locks several scope rows, ascending. */
export async function lockScopes(
  runner: TransactionRunner,
  trx: Trx,
  { scopeTable, scopeIds }: { scopeTable: string; scopeIds: Iterable<ScopeKey> }
): Promise<void> {
  for (const scopeId of ascending(scopeIds)) await lockScope(runner, trx, { scopeTable, scopeId })
}
