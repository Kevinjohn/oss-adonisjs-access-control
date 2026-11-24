import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import { isSqlIdentifier } from './identifiers.js'
import type { KeyType } from './types.js'

const keyTypes: readonly KeyType[] = ['integer', 'string', 'uuid']

/** The values `configure` and the tests put into `stubs/migrations/access_control_create_memberships.stub`. */
export interface MembershipsMigrationSchema {
  membershipsTable: string
  usersTable: string
  scopeTable: string
  /** The `scope_id` column builder expression for the scope key type. */
  scopeIdColumn: string
  /** The `user_id` column builder expression for the users key type. */
  userIdColumn: string
}

function createMigrationConfigError(detail: string): InvalidArgumentsException {
  return new InvalidArgumentsException(`access-control: ${detail}`)
}

/**
 * Column builders per key type, identical to Account Kit's: `integer` keys stay `integer()` so a
 * MySQL foreign key against an `increments()` parent matches.
 */
function formatKeyColumn(name: string, keyType: KeyType): string {
  return keyType === 'integer'
    ? `table.integer('${name}').unsigned()`
    : keyType === 'uuid'
      ? `table.uuid('${name}')`
      : `table.string('${name}', 254)`
}

/** Validates the names and key types and returns the stub data. */
export function buildMembershipMigrationSchema(input: {
  membershipsTable: string
  usersTable: string
  userKeyType: KeyType
  scopeTable: string
  scopeKeyType: KeyType
}): MembershipsMigrationSchema {
  for (const name of ['membershipsTable', 'usersTable', 'scopeTable'] as const)
    if (!isSqlIdentifier(input[name]))
      throw createMigrationConfigError(`${name} must be a plain SQL identifier`)
  // The released stub's longest generated name is `${membershipsTable}_scope_user_unique`.
  // PostgreSQL truncates identifiers beyond 63 bytes, which can collide with the other indexes.
  if (Buffer.byteLength(`${input.membershipsTable}_scope_user_unique`) > 63)
    throw createMigrationConfigError(
      'membershipsTable must be at most 45 characters for generated SQL identifiers'
    )
  for (const name of ['userKeyType', 'scopeKeyType'] as const)
    if (!keyTypes.includes(input[name]))
      throw createMigrationConfigError(`${name} must be integer, string or uuid`)
  return {
    membershipsTable: input.membershipsTable,
    usersTable: input.usersTable,
    scopeTable: input.scopeTable,
    scopeIdColumn: formatKeyColumn('scope_id', input.scopeKeyType),
    userIdColumn: formatKeyColumn('user_id', input.userKeyType),
  }
}
