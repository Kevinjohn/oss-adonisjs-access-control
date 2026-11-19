import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { KeyType, ScopeKey, UserKey } from './types.js'

/** Reads the exact spelling of a matching string parent key under the column's collation. */
export async function readStoredParentId(
  client: QueryClientContract,
  table: string,
  key: string
): Promise<string | undefined> {
  const row = (await client.from(table).select('id').where('id', key).first()) as
    { id: unknown } | null | undefined
  return row ? String(row.id) : undefined
}

/**
 * Resolves a normalized key to its stored spelling. Non-string key types are already
 * canonical, and a missing parent keeps the input so callers can check orphan rows.
 */
export async function resolveStoredParentId(
  client: QueryClientContract,
  table: string,
  keyType: KeyType,
  key: ScopeKey | UserKey
): Promise<ScopeKey | UserKey> {
  if (keyType !== 'string') return key
  return (await readStoredParentId(client, table, String(key))) ?? key
}
