// The membership service (specification section 5) over the lock process of section 4.2.
import type { Database } from '@adonisjs/lucid/database'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { AccessControl } from './define.js'
import { AccessControlError } from './errors.js'
import { normaliseKey } from './keys.js'
import { lockScope, lockScopes, lockUsers, ascending, sameKeys } from './locks.js'
import { decodeCursor, encodeCursor } from './pagination.js'
import type {
  AccessControlErrorCode,
  Actor,
  KeyType,
  Membership,
  MembershipEvent,
  MembershipPage,
  MembershipStatus,
  RuleResult,
  ScopeKey,
  TransactionRunner,
  Trx,
  UserKey,
} from './types.js'

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
  /** Required without an owner role; must not be given with one. */
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

interface Row {
  id: number
  scope_id: unknown
  user_id: unknown
  role: string
  status: string
  created_at: unknown
  updated_at: unknown
}

const statuses: readonly MembershipStatus[] = ['active', 'suspended']

function error(code: AccessControlErrorCode, message?: string): AccessControlError {
  return new AccessControlError(code, message ? { message: `access-control: ${message}` } : {})
}

function allow(result: RuleResult): void {
  if (!result.allowed) throw new AccessControlError(result.code)
}

/**
 * Memberships of users in scopes. Ordinary operations take an `actor` and apply the rules of
 * section 3 under the locks of section 4.2; trusted operations take no actor and must not be
 * exposed to request input without the application's own checks.
 */
export class MembershipService<Role extends string = string> {
  readonly #access: AccessControl<any, any>
  readonly #db: Database
  readonly #runner: TransactionRunner

  constructor(access: AccessControl<any, any>, db: Database, runner: TransactionRunner) {
    this.#access = access
    this.#db = db
    this.#runner = runner
  }

  get #table(): string {
    return this.#access.config.membershipsTable
  }

  get #usersTable(): string {
    return this.#access.config.users.table
  }

  get #scopeTable(): string {
    return this.#access.config.scope.table
  }

  #scopeKey(value: unknown): ScopeKey {
    return normaliseKey(this.#access.config.scope.keyType, value, 'scopeId')
  }

  #userKey(value: unknown, what = 'userId'): UserKey {
    return normaliseKey(this.#access.config.users.keyType, value, what)
  }

  #run<T>(trx: Trx | undefined, callback: (trx: Trx) => Promise<T>): Promise<T> {
    return trx ? callback(trx) : this.#runner.transaction(this.#db, callback)
  }

  #requireTrx(trx: Trx | undefined, method: string): Trx {
    if (!trx) throw error('E_ACCESS_CONTROL_INVALID_INPUT', `${method} requires a transaction`)
    return trx
  }

  #client(trx: Trx | undefined): QueryClientContract {
    return trx ?? this.#db.connection()
  }

  #toMembership(row: Row): Membership {
    return {
      scopeId: this.#scopeKey(row.scope_id),
      userId: this.#userKey(row.user_id),
      role: row.role,
      status: row.status as MembershipStatus,
      createdAt: this.#runner.readTimestamp(row.created_at)!,
      updatedAt: this.#runner.readTimestamp(row.updated_at)!,
    }
  }

  async #read(
    client: QueryClientContract,
    scopeId: ScopeKey,
    userId: UserKey
  ): Promise<Membership | null> {
    const row = (await client
      .from(this.#table)
      .where({ scope_id: scopeId, user_id: userId })
      .first()) as Row | null | undefined
    return row ? this.#toMembership(row) : null
  }

  async #readAll(client: QueryClientContract, userId: UserKey): Promise<Membership[]> {
    const rows = (await client
      .from(this.#table)
      .where('user_id', userId)
      .orderBy([
        { column: 'created_at', order: 'asc' },
        { column: 'id', order: 'asc' },
      ])) as Row[]
    return rows.map((row) => this.#toMembership(row))
  }

  async #scopeRows(client: QueryClientContract, scopeId: ScopeKey): Promise<Membership[]> {
    const rows = (await client
      .from(this.#table)
      .where('scope_id', scopeId)
      .orderBy('id', 'asc')) as Row[]
    return rows.map((row) => this.#toMembership(row))
  }

  async #emit(event: MembershipEvent<Role>, trx: Trx): Promise<void> {
    await this.#access.config.onMembershipChanged?.(event, trx)
  }

  async #insert(trx: Trx, scopeId: ScopeKey, userId: UserKey, role: string): Promise<Membership> {
    const now = this.#runner.sqlTimestamp(trx)
    await trx.table(this.#table).insert({
      scope_id: scopeId,
      user_id: userId,
      role,
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    return (await this.#read(trx, scopeId, userId))!
  }

  async #update(trx: Trx, scopeId: ScopeKey, userId: UserKey, patch: Record<string, unknown>) {
    await trx
      .from(this.#table)
      .where({ scope_id: scopeId, user_id: userId })
      .update({ ...patch, updated_at: this.#runner.sqlTimestamp(trx) })
    return (await this.#read(trx, scopeId, userId))!
  }

  async #delete(trx: Trx, scopeId: ScopeKey, userId: UserKey): Promise<void> {
    await trx.from(this.#table).where({ scope_id: scopeId, user_id: userId }).delete()
  }

  /** Locks the actor and target user rows ascending, then the scope row. */
  async #lock(trx: Trx, scopeId: ScopeKey, userIds: UserKey[]): Promise<void> {
    await lockUsers(this.#runner, trx, this.#usersTable, userIds)
    await lockScope(this.#runner, trx, this.#scopeTable, scopeId)
  }

  /**
   * The spelling the parent row stores for a `string` key, when a row matches: a database that
   * compares keys case-insensitively would otherwise lock, store and compare the caller's
   * spelling. Other key types are canonical after normalisation; a missing row keeps the input.
   */
  async #stored(trx: Trx, table: string, keyType: KeyType, key: ScopeKey | UserKey) {
    if (keyType !== 'string') return key
    const row = (await trx.from(table).select('id').where('id', key).first()) as
      { id: unknown } | null | undefined
    return row ? String(row.id) : key
  }

  #storedUser(trx: Trx, userId: UserKey): Promise<UserKey> {
    return this.#stored(trx, this.#usersTable, this.#access.config.users.keyType, userId)
  }

  #storedScope(trx: Trx, scopeId: ScopeKey): Promise<ScopeKey> {
    return this.#stored(trx, this.#scopeTable, this.#access.config.scope.keyType, scopeId)
  }

  /** The stored spellings of a scope and some users, read before any lock is taken. */
  async #storedKeys(
    trx: Trx,
    scopeId: ScopeKey,
    userIds: UserKey[]
  ): Promise<{ scopeId: ScopeKey; userIds: UserKey[] }> {
    const users: UserKey[] = []
    for (const id of userIds) users.push(await this.#storedUser(trx, id))
    return { scopeId: await this.#storedScope(trx, scopeId), userIds: users }
  }

  /**
   * The actor's active membership, then the rows that depend only on the actor: an unknown actor
   * role and `members:manage`. The target is looked at only after these pass.
   */
  async #requireManager(trx: Trx, scopeId: ScopeKey, actorId: UserKey): Promise<Membership> {
    const actor = await this.#read(trx, scopeId, actorId)
    if (!actor || actor.status !== 'active') throw error('E_ACCESS_CONTROL_FORBIDDEN')
    if (this.#access.rank(actor.role) < 0) throw error('E_ACCESS_CONTROL_UNKNOWN_ROLE')
    if (!this.#access.can(actor.role, 'members:manage')) throw error('E_ACCESS_CONTROL_FORBIDDEN')
    return actor
  }

  async #requireTarget(trx: Trx, scopeId: ScopeKey, userId: UserKey): Promise<Membership> {
    const target = await this.#read(trx, scopeId, userId)
    if (!target) throw error('E_ACCESS_CONTROL_NOT_A_MEMBER')
    return target
  }

  /** The membership, or null. A plain read without locks. */
  async find(scopeId: ScopeKey, userId: UserKey, trx?: Trx): Promise<Membership | null> {
    return this.#read(this.#client(trx), this.#scopeKey(scopeId), this.#userKey(userId))
  }

  /** Every membership of the user, ordered by `created_at, id`. A plain read without locks. */
  async listForUser(userId: UserKey, trx?: Trx): Promise<Membership[]> {
    return this.#readAll(this.#client(trx), this.#userKey(userId))
  }

  /**
   * The user's active membership when its role holds `permission`, read through the caller's
   * transaction. Throws `E_ACCESS_CONTROL_FORBIDDEN` for a missing or suspended membership, a
   * stored role outside the configured roles, and a role without the permission. Does not lock.
   */
  async authorize(input: AuthorizeInput): Promise<Membership> {
    const trx = this.#requireTrx(input.trx, 'authorize')
    const membership = await this.#read(
      trx,
      this.#scopeKey(input.scopeId),
      this.#userKey(input.userId)
    )
    if (
      !membership ||
      membership.status !== 'active' ||
      !this.#access.can(membership.role, input.permission)
    )
      throw error('E_ACCESS_CONTROL_FORBIDDEN')
    return membership
  }

  /** One page of a scope's members for an actor with `members:list`. Does not lock. */
  async listForScope(input: ListForScopeInput): Promise<MembershipPage> {
    const scopeId = this.#scopeKey(input.scopeId)
    const actorId = this.#userKey(input.actor.id, 'actor.id')
    const limit = input.limit ?? 25
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw error('E_ACCESS_CONTROL_INVALID_INPUT', 'limit must be an integer from 1 to 100')
    const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor)
    const client = this.#client(input.trx)
    const actor = await this.#read(client, scopeId, actorId)
    if (!actor || actor.status !== 'active' || !this.#access.can(actor.role, 'members:list'))
      throw error('E_ACCESS_CONTROL_FORBIDDEN')
    const query = client.from(this.#table).where('scope_id', scopeId)
    if (cursor) {
      const after = this.#runner.sqlTimestamp(client, this.#runner.readTimestamp(cursor.createdAt)!)
      query.where((sub) => {
        sub
          .where('created_at', '>', after)
          .orWhere((same) => same.where('created_at', after).where('id', '>', cursor.id))
      })
    }
    const rows = (await query
      .orderBy([
        { column: 'created_at', order: 'asc' },
        { column: 'id', order: 'asc' },
      ])
      .limit(limit + 1)) as Row[]
    const items = rows.slice(0, limit).map((row) => this.#toMembership(row))
    const last = rows.length > limit ? rows[limit - 1] : null
    return {
      items,
      nextCursor: last
        ? encodeCursor(this.#runner.readTimestamp(last.created_at)!.toUTC().toISO()!, last.id)
        : null,
    }
  }

  /** Adds a user to a scope with a role the actor may assign. */
  async add(input: AddMembershipInput): Promise<Membership> {
    let scopeId = this.#scopeKey(input.scopeId)
    let userId = this.#userKey(input.userId)
    let actorId = this.#userKey(input.actor.id, 'actor.id')
    return this.#run(input.trx, async (trx) => {
      const stored = await this.#storedKeys(trx, scopeId, [actorId, userId])
      ;[actorId, userId] = stored.userIds
      scopeId = stored.scopeId
      await this.#lock(trx, scopeId, [actorId, userId])
      const actor = await this.#requireManager(trx, scopeId, actorId)
      // The role rows depend on the actor and the input alone, so they come before the user lookup.
      allow(
        this.#access.canAssign({
          actorRole: actor.role,
          targetRole: input.role,
          nextRole: input.role,
          isSelf: actorId === userId,
        })
      )
      const user = await trx.from(this.#usersTable).select('id').where('id', userId).first()
      if (!user) throw error('E_ACCESS_CONTROL_USER_NOT_FOUND')
      if (await this.#read(trx, scopeId, userId)) throw error('E_ACCESS_CONTROL_ALREADY_MEMBER')
      const membership = await this.#insert(trx, scopeId, userId, input.role)
      await this.#emit(
        { type: 'membership.added', scopeId, userId, actorId, role: input.role as Role },
        trx
      )
      return membership
    })
  }

  /** Changes a member's role. An unchanged role writes nothing and emits nothing. */
  async changeRole(input: ChangeRoleInput): Promise<Membership> {
    let scopeId = this.#scopeKey(input.scopeId)
    let userId = this.#userKey(input.userId)
    let actorId = this.#userKey(input.actor.id, 'actor.id')
    return this.#run(input.trx, async (trx) => {
      const stored = await this.#storedKeys(trx, scopeId, [actorId, userId])
      ;[actorId, userId] = stored.userIds
      scopeId = stored.scopeId
      await this.#lock(trx, scopeId, [actorId, userId])
      const actor = await this.#requireManager(trx, scopeId, actorId)
      const target = await this.#requireTarget(trx, scopeId, userId)
      allow(
        this.#access.canAssign({
          actorRole: actor.role,
          targetRole: target.role,
          nextRole: input.role,
          isSelf: actorId === userId,
        })
      )
      if (target.role === input.role) return target
      const membership = await this.#update(trx, scopeId, userId, { role: input.role })
      await this.#emit(
        {
          type: 'membership.role_changed',
          scopeId,
          userId,
          actorId,
          from: target.role as Role,
          to: input.role as Role,
        },
        trx
      )
      return membership
    })
  }

  /** Suspends or reactivates a member. An unchanged status writes nothing and emits nothing. */
  async setStatus(input: SetStatusInput): Promise<Membership> {
    let scopeId = this.#scopeKey(input.scopeId)
    let userId = this.#userKey(input.userId)
    let actorId = this.#userKey(input.actor.id, 'actor.id')
    if (!statuses.includes(input.status))
      throw error('E_ACCESS_CONTROL_INVALID_INPUT', 'status must be active or suspended')
    return this.#run(input.trx, async (trx) => {
      const stored = await this.#storedKeys(trx, scopeId, [actorId, userId])
      ;[actorId, userId] = stored.userIds
      scopeId = stored.scopeId
      await this.#lock(trx, scopeId, [actorId, userId])
      const actor = await this.#requireManager(trx, scopeId, actorId)
      const target = await this.#requireTarget(trx, scopeId, userId)
      allow(
        this.#access.canManage({
          actorRole: actor.role,
          targetRole: target.role,
          isSelf: actorId === userId,
        })
      )
      if (target.status === input.status) return target
      const membership = await this.#update(trx, scopeId, userId, { status: input.status })
      await this.#emit(
        {
          type: 'membership.status_changed',
          scopeId,
          userId,
          actorId,
          from: target.status,
          to: input.status,
        },
        trx
      )
      return membership
    })
  }

  /** Removes a member the actor may manage. */
  async remove(input: RemoveMembershipInput): Promise<void> {
    let scopeId = this.#scopeKey(input.scopeId)
    let userId = this.#userKey(input.userId)
    let actorId = this.#userKey(input.actor.id, 'actor.id')
    await this.#run(input.trx, async (trx) => {
      const stored = await this.#storedKeys(trx, scopeId, [actorId, userId])
      ;[actorId, userId] = stored.userIds
      scopeId = stored.scopeId
      await this.#lock(trx, scopeId, [actorId, userId])
      const actor = await this.#requireManager(trx, scopeId, actorId)
      const target = await this.#requireTarget(trx, scopeId, userId)
      allow(
        this.#access.canManage({
          actorRole: actor.role,
          targetRole: target.role,
          isSelf: actorId === userId,
        })
      )
      await this.#delete(trx, scopeId, userId)
      await this.#emit(
        {
          type: 'membership.removed',
          scopeId,
          userId,
          actorId,
          role: target.role as Role,
          reason: 'removed',
        },
        trx
      )
    })
  }

  /** A member leaves on their own, suspended or not; the owner cannot. */
  async leave(input: LeaveInput): Promise<void> {
    let scopeId = this.#scopeKey(input.scopeId)
    let userId = this.#userKey(input.userId)
    await this.#run(input.trx, async (trx) => {
      const stored = await this.#storedKeys(trx, scopeId, [userId])
      ;[userId] = stored.userIds
      scopeId = stored.scopeId
      try {
        await this.#lock(trx, scopeId, [userId])
      } catch (caught) {
        // Any signed-in user may call leave, so a missing scope reads like a missing membership.
        if (
          caught instanceof AccessControlError &&
          caught.code === 'E_ACCESS_CONTROL_SCOPE_NOT_FOUND'
        )
          throw error('E_ACCESS_CONTROL_NOT_A_MEMBER')
        throw caught
      }
      const membership = await this.#requireTarget(trx, scopeId, userId)
      if (this.#access.ownerRole !== undefined && membership.role === this.#access.ownerRole)
        throw error('E_ACCESS_CONTROL_OWNER_PROTECTED')
      await this.#delete(trx, scopeId, userId)
      await this.#emit(
        { type: 'membership.left', scopeId, userId, role: membership.role as Role },
        trx
      )
    })
  }

  /** The active owner hands the owner role to an active member and takes the highest non-owner role. */
  async transferOwnership(input: TransferOwnershipInput): Promise<void> {
    const ownerRole = this.#access.ownerRole
    if (ownerRole === undefined) throw error('E_ACCESS_CONTROL_OWNER_DISABLED')
    let scopeId = this.#scopeKey(input.scopeId)
    let toUserId = this.#userKey(input.toUserId, 'toUserId')
    let actorId = this.#userKey(input.actor.id, 'actor.id')
    const roles = this.#access.roles
    const demotedTo = roles[roles.length - 2]
    await this.#run(input.trx, async (trx) => {
      const stored = await this.#storedKeys(trx, scopeId, [actorId, toUserId])
      ;[actorId, toUserId] = stored.userIds
      scopeId = stored.scopeId
      await this.#lock(trx, scopeId, [actorId, toUserId])
      const actor = await this.#read(trx, scopeId, actorId)
      if (!actor || actor.status !== 'active' || actor.role !== ownerRole)
        throw error('E_ACCESS_CONTROL_FORBIDDEN')
      if (toUserId === actorId) throw error('E_ACCESS_CONTROL_SELF_MANAGEMENT')
      const target = await this.#requireTarget(trx, scopeId, toUserId)
      if (target.status !== 'active')
        throw error('E_ACCESS_CONTROL_INVALID_INPUT', 'ownership can only go to an active member')
      await this.#update(trx, scopeId, actorId, { role: demotedTo })
      await this.#update(trx, scopeId, toUserId, { role: ownerRole })
      await this.#emit(
        {
          type: 'membership.ownership_transferred',
          scopeId,
          fromUserId: actorId,
          toUserId,
          demotedTo: demotedTo as Role,
        },
        trx
      )
    })
  }

  /** Trusted: the first member of an empty scope, as owner when owner rules are on. */
  async createFirstMember(input: CreateFirstMemberInput): Promise<Membership> {
    let scopeId = this.#scopeKey(input.scopeId)
    let userId = this.#userKey(input.userId)
    const ownerRole = this.#access.ownerRole
    let role: string
    if (ownerRole !== undefined) {
      if (input.role !== undefined && input.role !== ownerRole)
        throw error('E_ACCESS_CONTROL_INVALID_INPUT', 'the first member takes the owner role')
      role = ownerRole
    } else {
      if (input.role === undefined || !this.#access.can(input.role, 'members:manage'))
        throw error(
          'E_ACCESS_CONTROL_INVALID_INPUT',
          'the first member needs a role with members:manage'
        )
      role = input.role
    }
    return this.#run(input.trx, async (trx) => {
      const stored = await this.#storedKeys(trx, scopeId, [userId])
      ;[userId] = stored.userIds
      scopeId = stored.scopeId
      await this.#lock(trx, scopeId, [userId])
      const existing = await trx.from(this.#table).where('scope_id', scopeId).first()
      if (existing) throw error('E_ACCESS_CONTROL_SCOPE_NOT_EMPTY')
      const membership = await this.#insert(trx, scopeId, userId, role)
      await this.#emit(
        { type: 'membership.first_member', scopeId, userId, role: role as Role },
        trx
      )
      return membership
    })
  }

  /** Trusted: the membership an accepted invitation grants, inside the kit's transaction. */
  async acceptInvitation(input: AcceptInvitationInput): Promise<Membership> {
    const trx = this.#requireTrx(input.trx, 'acceptInvitation')
    if (this.#access.rank(input.role) < 0 || input.role === this.#access.ownerRole)
      throw error(
        'E_ACCESS_CONTROL_INVALID_INPUT',
        'an invitation role must be a known non-owner role'
      )
    const { scopeId, userIds } = await this.#storedKeys(trx, this.#scopeKey(input.scopeId), [
      this.#userKey(input.userId),
    ])
    const [userId] = userIds
    await this.#lock(trx, scopeId, [userId])
    if (await this.#read(trx, scopeId, userId)) throw error('E_ACCESS_CONTROL_ALREADY_MEMBER')
    const membership = await this.#insert(trx, scopeId, userId, input.role)
    await this.#emit(
      {
        type: 'membership.invitation_accepted',
        scopeId,
        userId,
        role: input.role as Role,
        invitationId: input.invitationId,
      },
      trx
    )
    return membership
  }

  /** Trusted: a membership the application grants after its own admission checks, in its transaction. */
  async grant(input: GrantMembershipInput): Promise<Membership> {
    const trx = this.#requireTrx(input.trx, 'grant')
    if (this.#access.rank(input.role) < 0 || input.role === this.#access.ownerRole)
      throw error('E_ACCESS_CONTROL_INVALID_INPUT', 'a granted role must be a known non-owner role')
    const { scopeId, userIds } = await this.#storedKeys(trx, this.#scopeKey(input.scopeId), [
      this.#userKey(input.userId),
    ])
    const [userId] = userIds
    await this.#lock(trx, scopeId, [userId])
    const user = await trx.from(this.#usersTable).select('id').where('id', userId).first()
    if (!user) throw error('E_ACCESS_CONTROL_USER_NOT_FOUND')
    if (await this.#read(trx, scopeId, userId)) throw error('E_ACCESS_CONTROL_ALREADY_MEMBER')
    const membership = await this.#insert(trx, scopeId, userId, input.role)
    await this.#emit({ type: 'membership.granted', scopeId, userId, role: input.role as Role }, trx)
    return membership
  }

  /** Trusted: both users' role maps under the locks of 4.2, for the identity predicate. */
  async identityRoles(input: IdentityInput): Promise<IdentityRoles> {
    return this.#run(input.trx, async (trx) => {
      const actorId = await this.#storedUser(trx, this.#userKey(input.actorId, 'actorId'))
      const targetId = await this.#storedUser(trx, this.#userKey(input.targetId, 'targetId'))
      await lockUsers(this.#runner, trx, this.#usersTable, [actorId, targetId])
      const actorMemberships = await this.#readAll(trx, actorId)
      const targetMemberships =
        actorId === targetId ? actorMemberships : await this.#readAll(trx, targetId)
      await lockScopes(
        this.#runner,
        trx,
        this.#scopeTable,
        [...actorMemberships, ...targetMemberships].map((m) => m.scopeId)
      )
      const byScope = (list: Membership[]) => {
        const map = new Map<ScopeKey, string>()
        for (const scopeId of ascending(list.map((m) => m.scopeId)))
          map.set(scopeId, list.find((m) => m.scopeId === scopeId)!.role)
        return map
      }
      return {
        actorRoles: byScope(actorMemberships.filter((m) => m.status === 'active')),
        targetRoles: byScope(targetMemberships),
      }
    })
  }

  /** Trusted: `identityRoles` then the identity predicate; false is `FORBIDDEN`. */
  async assertCanAdministerIdentity(input: IdentityInput): Promise<void> {
    await this.#run(input.trx, async (trx) => {
      const actorId = await this.#storedUser(trx, this.#userKey(input.actorId, 'actorId'))
      const targetId = await this.#storedUser(trx, this.#userKey(input.targetId, 'targetId'))
      const { actorRoles, targetRoles } = await this.identityRoles({ actorId, targetId, trx })
      if (!this.#access.canAdministerIdentity(actorRoles, targetRoles, actorId === targetId))
        throw error('E_ACCESS_CONTROL_FORBIDDEN')
    })
  }

  /** Called by the kit's deleting hook: refuses an active owner, else removes every membership. */
  async prepareAccountDeletion(input: PrepareAccountDeletionInput): Promise<void> {
    const trx = this.#requireTrx(input.trx, 'prepareAccountDeletion')
    const userId = await this.#storedUser(trx, this.#userKey(input.userId))
    const memberships = await this.#readAll(trx, userId)
    await lockScopes(
      this.#runner,
      trx,
      this.#scopeTable,
      memberships.map((m) => m.scopeId)
    )
    const ownerRole = this.#access.ownerRole
    if (
      ownerRole !== undefined &&
      memberships.some((m) => m.role === ownerRole && m.status === 'active')
    )
      throw error('E_ACCESS_CONTROL_LAST_OWNER')
    await trx.from(this.#table).where('user_id', userId).delete()
    for (const membership of memberships)
      await this.#emit(
        {
          type: 'membership.removed',
          scopeId: membership.scopeId,
          userId,
          actorId: null,
          role: membership.role as Role,
          reason: 'account_deleted',
        },
        trx
      )
  }

  /** Called by the app before deleting a scope row: removes every membership of the scope. */
  async removeAllForScope(input: RemoveAllForScopeInput): Promise<void> {
    const trx = this.#requireTrx(input.trx, 'removeAllForScope')
    const scopeId = await this.#storedScope(trx, this.#scopeKey(input.scopeId))
    const actorId =
      input.actor === undefined
        ? null
        : await this.#storedUser(trx, this.#userKey(input.actor.id, 'actor.id'))
    const before = await this.#scopeRows(trx, scopeId)
    await lockUsers(
      this.#runner,
      trx,
      this.#usersTable,
      before.map((m) => m.userId)
    )
    await lockScope(this.#runner, trx, this.#scopeTable, scopeId)
    const members = await this.#scopeRows(trx, scopeId)
    if (
      !sameKeys(
        before.map((m) => m.userId),
        members.map((m) => m.userId)
      )
    )
      throw error('E_ACCESS_CONTROL_CONFLICT')
    await trx.from(this.#table).where('scope_id', scopeId).delete()
    for (const membership of members)
      await this.#emit(
        {
          type: 'membership.removed',
          scopeId,
          userId: membership.userId,
          actorId,
          role: membership.role as Role,
          reason: 'scope_deleted',
        },
        trx
      )
  }

  /** The user's memberships with ISO timestamps, for a data export. */
  async exportFor(input: ExportForInput): Promise<MembershipExport> {
    const memberships = await this.listForUser(input.userId, input.trx)
    return {
      memberships: memberships.map((m) => ({
        scopeId: m.scopeId,
        role: m.role,
        status: m.status,
        createdAt: m.createdAt.toUTC().toISO()!,
        updatedAt: m.updatedAt.toUTC().toISO()!,
      })),
    }
  }
}
