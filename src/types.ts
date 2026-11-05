import type { DateTime } from 'luxon'
import type { Database } from '@adonisjs/lucid/database'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { AccessControl } from './define.js'

export type {
  MembershipService,
  AddMembershipInput,
  ChangeRoleInput,
  SetStatusInput,
  RemoveMembershipInput,
  LeaveInput,
  TransferOwnershipInput,
  ListForScopeInput,
  CreateFirstMemberInput,
  AcceptInvitationInput,
  IdentityInput,
  IdentityRoles,
  PrepareAccountDeletionInput,
  RemoveAllForScopeInput,
  ExportForInput,
  MembershipExport,
} from './memberships.js'

/** A Lucid transaction client, as started by Account Kit's `transaction()` runner. */
export type Trx = TransactionClientContract

/** Key types for the users and scope tables; the same set as Account Kit's `--user-id-type`. */
export type KeyType = 'integer' | 'string' | 'uuid'

/** A scope (team) primary key after normalisation. */
export type ScopeKey = number | string

/** A user primary key after normalisation. */
export type UserKey = number | string

/** The two membership states. */
export type MembershipStatus = 'active' | 'suspended'

/** One membership row: a user's role in one scope. */
export interface Membership {
  scopeId: ScopeKey
  userId: UserKey
  role: string
  status: MembershipStatus
  createdAt: DateTime
  updatedAt: DateTime
}

/** The acting user of an actor-authorised operation. */
export interface Actor {
  id: UserKey
}

/** Events passed to `onMembershipChanged` inside the write transaction, after the write. */
export type MembershipEvent<Role extends string> =
  | { type: 'membership.added'; scopeId: ScopeKey; userId: UserKey; actorId: UserKey; role: Role }
  | { type: 'membership.first_member'; scopeId: ScopeKey; userId: UserKey; role: Role }
  | {
      type: 'membership.invitation_accepted'
      scopeId: ScopeKey
      userId: UserKey
      role: Role
      invitationId: number
    }
  | {
      type: 'membership.role_changed'
      scopeId: ScopeKey
      userId: UserKey
      actorId: UserKey
      from: Role
      to: Role
    }
  | {
      type: 'membership.status_changed'
      scopeId: ScopeKey
      userId: UserKey
      actorId: UserKey
      from: MembershipStatus
      to: MembershipStatus
    }
  | {
      type: 'membership.removed'
      scopeId: ScopeKey
      userId: UserKey
      actorId: UserKey | null
      role: Role
      reason: 'removed' | 'scope_deleted' | 'account_deleted'
    }
  | { type: 'membership.left'; scopeId: ScopeKey; userId: UserKey; role: Role }
  | {
      type: 'membership.ownership_transferred'
      scopeId: ScopeKey
      fromUserId: UserKey
      toUserId: UserKey
      demotedTo: Role
    }

/** One page of a scope's members. */
export interface MembershipPage {
  items: Membership[]
  nextCursor: string | null
}

/**
 * The permission matrix: resource, then action, then the lowest role allowed. The reserved
 * keys `members:list`, `members:manage` and `invitations:manage` are always present.
 */
export type PermissionMap<Role extends string> = Record<string, Record<string, Role>> & {
  members: { list: Role; manage: Role } & Record<string, Role>
  invitations: { manage: Role } & Record<string, Role>
}

/** The configuration accepted by `defineAccessControl`. */
export interface AccessControlConfig<
  R extends readonly [string, ...string[]],
  P extends PermissionMap<R[number]>,
> {
  /** Lowest rank first. Rank is the index. */
  roles: R
  /** Optional. Must be the last (highest) role when set. Enables owner rules. */
  ownerRole?: R[number]
  /** The app's users table and key type (must match Account Kit's). */
  users: { table: string; keyType: KeyType }
  /** The app's scope (team) table and key type. */
  scope: { table: string; keyType: KeyType }
  /** Memberships table name. Default 'memberships'. Set it when the app already has that table. */
  membershipsTable?: string
  /** resource -> action -> lowest role allowed. Must include the reserved keys. */
  permissions: P
  /**
   * Runs inside every membership write transaction, after the write. Throwing rolls back.
   * It must not lock or write other users' rows or Account Kit tables, which sit earlier in the
   * lock order; writing app tables is fine.
   */
  onMembershipChanged?: (event: MembershipEvent<R[number]>, trx: Trx) => Promise<void>
}

/** The validated, frozen configuration carried by an `AccessControl` instance. */
export interface ResolvedAccessControlConfig<
  R extends readonly [string, ...string[]] = readonly [string, ...string[]],
  P extends PermissionMap<R[number]> = PermissionMap<R[number]>,
> extends AccessControlConfig<R, P> {
  membershipsTable: string
}

/** `'resource:action'` keys of a permission map. */
export type PermissionKeysOfMap<P> = {
  [Res in keyof P & string]: `${Res}:${keyof P[Res] & string}`
}[keyof P & string]

/**
 * `'project:read' | 'project:write' | ...` derived from a permission map or from the
 * `AccessControl` instance a config file exports.
 */
export type PermissionKeyOf<T> =
  T extends AccessControl<any, infer P> ? PermissionKeysOfMap<P> : PermissionKeysOfMap<T>

/** The role union of an `AccessControl` instance. */
export type RoleOf<T> = T extends AccessControl<infer R, any> ? R[number] : never

/** The outcome of a pure rule: allowed, or denied with the error code to raise. */
export type RuleResult = { allowed: true } | { allowed: false; code: AccessControlErrorCode }

/** Every public error code. */
export type AccessControlErrorCode =
  | 'E_ACCESS_CONTROL_FORBIDDEN'
  | 'E_ACCESS_CONTROL_NOT_A_MEMBER'
  | 'E_ACCESS_CONTROL_USER_NOT_FOUND'
  | 'E_ACCESS_CONTROL_ALREADY_MEMBER'
  | 'E_ACCESS_CONTROL_UNKNOWN_ROLE'
  | 'E_ACCESS_CONTROL_RANK_TOO_LOW'
  | 'E_ACCESS_CONTROL_OWNER_PROTECTED'
  | 'E_ACCESS_CONTROL_SELF_MANAGEMENT'
  | 'E_ACCESS_CONTROL_OWNER_DISABLED'
  | 'E_ACCESS_CONTROL_LAST_OWNER'
  | 'E_ACCESS_CONTROL_SCOPE_NOT_EMPTY'
  | 'E_ACCESS_CONTROL_SCOPE_NOT_FOUND'
  | 'E_ACCESS_CONTROL_INVALID_INPUT'
  | 'E_ACCESS_CONTROL_INVALID_CONFIG'
  | 'E_ACCESS_CONTROL_CONFLICT'

/** Anything that can say which SQL dialect it talks to: a query client, transaction or database. */
export type DialectSource = DialectClient | DialectDatabase

/** A query client or transaction: it knows its dialect. */
export interface DialectClient {
  dialect: { name: string }
}

/** A Lucid `Database`: its default connection knows the dialect. */
export interface DialectDatabase {
  /** The default connection's query client. */
  connection(): DialectClient
}

/**
 * The transaction helpers of specification 0.2, as `@kevinjohn/adonisjs-account-kit/transaction`
 * exports them. `source` says whether the kit's export or the package's local runner is in use.
 */
export interface TransactionRunner {
  source: 'account-kit' | 'local'
  /** Runs a database-only callback in its own transaction; SQLite writers serialise on the kit's lock row. */
  transaction<T>(db: Database, callback: (trx: Trx) => Promise<T>): Promise<T>
  /** Locks one row by `id`; a no-op on SQLite, where the runner already holds the writer lock. */
  lockRow(trx: Trx, table: string, id: number | string): Promise<void>
  /** The value to write or compare for a timestamp column, in UTC. */
  sqlTimestamp(client: DialectSource, at?: DateTime): string
  /** Reads a timestamp column whatever the driver returns. */
  readTimestamp(value: unknown): DateTime | null
}

/** The payload a client receives for the current membership. */
export interface ClientPayload<Role extends string = string, Key extends string = string> {
  scopeId: string
  role: Role
  permissions: Key[]
  assignableRoles: Role[]
}
