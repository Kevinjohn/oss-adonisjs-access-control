import { AccessControlError } from './errors.js'
import { isSqlIdentifier } from './identifiers.js'
import type { KeyType } from './types.js'

const keyTypes: readonly KeyType[] = ['integer', 'string', 'uuid']

/** The values `configure` and the tests put into `stubs/migrations/create_memberships.stub`. */
export interface MembershipsMigrationSchema {
  membershipsTable: string
  usersTable: string
  scopeTable: string
  /** The `scope_id` column builder expression for the scope key type. */
  scopeIdColumn: string
  /** The `user_id` column builder expression for the users key type. */
  userIdColumn: string
}

function invalid(detail: string): AccessControlError {
  return new AccessControlError('E_ACCESS_CONTROL_INVALID_CONFIG', {
    message: `access-control: ${detail}`,
  })
}

/**
 * Column builders per key type, identical to Account Kit's: `integer` keys stay `integer()` so a
 * MySQL foreign key against an `increments()` parent matches.
 */
function keyColumn(name: string, keyType: KeyType): string {
  return keyType === 'integer'
    ? `table.integer('${name}').unsigned()`
    : keyType === 'uuid'
      ? `table.uuid('${name}')`
      : `table.string('${name}', 254)`
}

/** Validates the names and key types and returns the stub data. */
export function membershipsMigrationSchema(input: {
  membershipsTable: string
  usersTable: string
  userKeyType: KeyType
  scopeTable: string
  scopeKeyType: KeyType
}): MembershipsMigrationSchema {
  for (const name of ['membershipsTable', 'usersTable', 'scopeTable'] as const)
    if (!isSqlIdentifier(input[name])) throw invalid(`${name} must be a plain SQL identifier`)
  for (const name of ['userKeyType', 'scopeKeyType'] as const)
    if (!keyTypes.includes(input[name])) throw invalid(`${name} must be integer, string or uuid`)
  return {
    membershipsTable: input.membershipsTable,
    usersTable: input.usersTable,
    scopeTable: input.scopeTable,
    scopeIdColumn: keyColumn('scope_id', input.scopeKeyType),
    userIdColumn: keyColumn('user_id', input.userKeyType),
  }
}
