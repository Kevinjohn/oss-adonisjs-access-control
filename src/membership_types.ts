import type { MembershipService as Service } from './memberships.ts'
import type { Actor, MembershipStatus, ScopeKey, Trx, UserKey } from './types.ts'

/** The membership service attached to the application’s AccessControl instance. */
export type MembershipService<Role extends string = string> = Service<Role>

/** Input of `add`: the acting member, the scope, the user to add and the role to give. */
export interface AddMembershipInput {
  actor: Actor
  scopeId: ScopeKey
  userId: UserKey
  role: string
  trx?: Trx
}
/** Input of `changeRole`: the acting member, the scope, the member and the next role. */
export interface ChangeRoleInput extends AddMembershipInput {}
/** Input of `setStatus`: the acting member, the scope, the member and the next status. */
export interface SetStatusInput {
  actor: Actor
  scopeId: ScopeKey
  userId: UserKey
  status: MembershipStatus
  trx?: Trx
}
/** Input of `remove`: the acting member, the scope and the member to remove. */
export interface RemoveMembershipInput {
  actor: Actor
  scopeId: ScopeKey
  userId: UserKey
  trx?: Trx
}
/** Input of `leave`: the scope and the leaving member. */
export interface LeaveInput {
  scopeId: ScopeKey
  userId: UserKey
  trx?: Trx
}
/** Input of `transferOwnership`: the acting owner, the scope and the next owner. */
export interface TransferOwnershipInput {
  actor: Actor
  scopeId: ScopeKey
  toUserId: UserKey
  trx?: Trx
}
/** Input of `listForScope`: the acting member, the scope, and the page to read. */
export interface ListForScopeInput {
  actor: Actor
  scopeId: ScopeKey
  cursor?: string
  /** 1 to 100, default 25. */
  limit?: number
  trx?: Trx
}
/** Input of `authorize`: the scope, the user, the permission key and the caller's transaction. */
export interface AuthorizeInput {
  scopeId: ScopeKey
  userId: UserKey
  /** A permission key from the configured matrix. */
  permission: string
  /** Required: the check belongs to the transaction that does the work it authorizes. */
  trx: Trx
}
/** Input of the trusted `createFirstMember`. */
export interface CreateFirstMemberInput {
  scopeId: ScopeKey
  userId: UserKey
  /** Required without an owner role; when an owner role is configured, omit it or give that role. */
  role?: string
  trx?: Trx
}
/** Input of the trusted `acceptInvitation`, from an Account Kit invitation hook. */
export interface AcceptInvitationInput {
  scopeId: ScopeKey
  userId: UserKey
  role: string
  invitationId: number
  /** Required: the kit hook's transaction. */
  trx: Trx
}
/** Input of the trusted `grant`: a membership the application has authorised itself. */
export interface GrantMembershipInput {
  scopeId: ScopeKey
  userId: UserKey
  role: string
  /** Required: the application's transaction, started with the kit runner. */
  trx: Trx
}
/** Input of the trusted `identityRoles` and `assertCanAdministerIdentity`. */
export interface IdentityInput {
  actorId: UserKey
  targetId: UserKey
  trx?: Trx
}
/** Maps keyed by scope in ascending `String(key)` order (specification 3.4). */
export interface IdentityRoles {
  /** The actor's active memberships. */
  actorRoles: Map<ScopeKey, string>
  /** Every membership of the target, suspended ones included. */
  targetRoles: Map<ScopeKey, string>
}
/** Input of `prepareAccountDeletion`, from the kit's deleting hook. */
export interface PrepareAccountDeletionInput {
  userId: UserKey
  /** Required: the kit's deleting-hook transaction, which already holds the user row. */
  trx: Trx
}
/** Input of `removeAllForScope`, from the app's scope deletion. */
export interface RemoveAllForScopeInput {
  scopeId: ScopeKey
  actor?: Actor
  /** Required: the app's transaction that deletes the scope row afterwards. */
  trx: Trx
}
/** Input of `exportFor`. */
export interface ExportForInput {
  userId: UserKey
  trx?: Trx
}
/** The `exportFor` result: every membership of the user with ISO 8601 timestamps. */
export interface MembershipExport {
  memberships: Array<{
    scopeId: ScopeKey
    role: string
    status: MembershipStatus
    createdAt: string
    updatedAt: string
  }>
}
