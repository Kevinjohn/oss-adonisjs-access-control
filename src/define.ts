import type { Database } from '@adonisjs/lucid/database'
import { InvalidArgumentsException, RuntimeException } from '@adonisjs/core/exceptions'
import { MembershipService } from './memberships.js'
import { createAbilities, type AbilityMap, type MembershipResolver } from './abilities.js'
import { buildClientPayload } from './payload.js'
import { sqlIdentifierPattern } from './identifiers.js'
import * as rules from './rules.js'
import type { RoleMatrix } from './rules.js'
import type {
  AccessControlConfig,
  ClientPayload,
  KeyType,
  Membership,
  PermissionKeyOf,
  PermissionMap,
  ResolvedAccessControlConfig,
  RuleResult,
  ScopeKey,
  TransactionRunner,
} from './types.js'

const rolePattern = /^[a-z][a-z0-9_-]*$/
const namePattern = /^[a-z][a-zA-Z0-9]*$/
const keyTypes: readonly KeyType[] = ['integer', 'string', 'uuid']
const reservedKeys = ['members:list', 'members:manage', 'invitations:manage'] as const

function createInvalidConfigError(detail: string): InvalidArgumentsException {
  return new InvalidArgumentsException(`access-control: invalid configuration: ${detail}`)
}

function assertIdentifier(name: string, value: unknown): void {
  if (typeof value !== 'string' || !sqlIdentifierPattern.test(value))
    throw createInvalidConfigError(`${name} ${JSON.stringify(value)} is not a plain SQL identifier`)
}

function assertKeyType(name: string, value: unknown): void {
  if (!keyTypes.includes(value as KeyType))
    throw createInvalidConfigError(
      `${name} ${JSON.stringify(value)} must be integer, string or uuid`
    )
}

/** Validation per specification 2.3; returns the matrix the rules read. */
function requireRoleMatrix(config: AccessControlConfig<any, any>): RoleMatrix {
  const roles: unknown = config.roles
  if (!Array.isArray(roles) || roles.length === 0)
    throw createInvalidConfigError('roles must list at least one role')
  for (const role of roles) {
    if (typeof role !== 'string' || !rolePattern.test(role) || role.length > 32)
      throw createInvalidConfigError(
        `role name ${JSON.stringify(role)} must match ^[a-z][a-z0-9_-]*$ and be at most 32 characters`
      )
    if (roles.indexOf(role) !== roles.lastIndexOf(role))
      throw createInvalidConfigError(`duplicate role "${role}"`)
  }
  const permissions: unknown = config.permissions
  if (typeof permissions !== 'object' || permissions === null)
    throw createInvalidConfigError('permissions must be an object of resources')
  const minimumRoleByPermission = new Map<string, string>()
  for (const [resource, actions] of Object.entries(permissions as Record<string, unknown>)) {
    if (!namePattern.test(resource))
      throw createInvalidConfigError(
        `resource name ${JSON.stringify(resource)} must match ^[a-z][a-zA-Z0-9]*$`
      )
    if (typeof actions !== 'object' || actions === null)
      throw createInvalidConfigError(`resource "${resource}" must map actions to roles`)
    for (const [action, role] of Object.entries(actions as Record<string, unknown>)) {
      if (!namePattern.test(action))
        throw createInvalidConfigError(
          `action name ${JSON.stringify(action)} must match ^[a-z][a-zA-Z0-9]*$`
        )
      if (typeof role !== 'string' || !roles.includes(role))
        throw createInvalidConfigError(
          `permission ${resource}:${action} names ${JSON.stringify(role)}, not a role`
        )
      minimumRoleByPermission.set(`${resource}:${action}`, role)
    }
  }
  for (const key of reservedKeys)
    if (!minimumRoleByPermission.has(key))
      throw createInvalidConfigError(`reserved key ${key} is missing`)
  const ownerRole: unknown = config.ownerRole
  if (ownerRole !== undefined) {
    if (roles.length < 2) throw createInvalidConfigError('ownerRole needs at least two roles')
    if (ownerRole !== roles[roles.length - 1])
      throw createInvalidConfigError(`ownerRole ${JSON.stringify(ownerRole)} must be the last role`)
  }
  assertIdentifier('users.table', config.users?.table)
  assertKeyType('users.keyType', config.users?.keyType)
  assertIdentifier('scope.table', config.scope?.table)
  assertKeyType('scope.keyType', config.scope?.keyType)
  if (config.membershipsTable !== undefined)
    assertIdentifier('membershipsTable', config.membershipsTable)
  return {
    roles: Object.freeze([...roles]),
    ownerRole: ownerRole as string | undefined,
    minimumRoleByPermission,
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}

/**
 * The validated configuration with the pure rules. A config file exports the instance returned
 * by `defineAccessControl`; the provider resolves the same instance from the container.
 *
 * @example
 * ```ts
 * import { AccessControl } from '@kevinjohn/adonisjs-access-control'
 *
 * const access = new AccessControl({
 *   roles: ['viewer', 'admin'],
 *   users: { table: 'users', keyType: 'integer' },
 *   scope: { table: 'teams', keyType: 'integer' },
 *   permissions: {
 *     members: { list: 'viewer', manage: 'admin' },
 *     invitations: { manage: 'admin' },
 *   },
 * })
 * ```
 */
export class AccessControl<
  const R extends readonly [string, ...string[]] = readonly [string, ...string[]],
  const P extends PermissionMap<R[number]> = PermissionMap<R[number]>,
> {
  /** The validated, frozen configuration. */
  readonly config: ResolvedAccessControlConfig<R, P>
  /** Roles, lowest rank first. */
  readonly roles: Readonly<R>
  /** The owner role, when owner rules are enabled. */
  readonly ownerRole: R[number] | undefined
  /** Every permission key, in declaration order. */
  readonly permissionKeys: readonly PermissionKeyOf<P>[]
  readonly #matrix: RoleMatrix
  #service: MembershipService<R[number]> | undefined

  constructor(config: AccessControlConfig<R, P>) {
    this.#matrix = requireRoleMatrix(config)
    // Freeze copies, so the caller's own objects stay writable.
    this.config = deepFreeze({
      ...config,
      roles: [...config.roles] as unknown as R,
      users: { ...config.users },
      scope: { ...config.scope },
      permissions: Object.fromEntries(
        Object.entries(config.permissions).map(([resource, actions]) => [resource, { ...actions }])
      ) as P,
      membershipsTable: config.membershipsTable ?? 'memberships',
    }) as ResolvedAccessControlConfig<R, P>
    this.roles = this.config.roles
    this.ownerRole = this.config.ownerRole
    this.permissionKeys = Object.freeze([
      ...this.#matrix.minimumRoleByPermission.keys(),
    ] as PermissionKeyOf<P>[])
    Object.freeze(this)
  }

  /**
   * Binds the database and transaction runner; the provider calls this at boot. The instance
   * stays frozen, so the binding lives in a private field.
   *
   * @example
   * ```ts
   * access.attach(db, {
   *   source: 'account-kit',
   *   transaction,
   *   lockRow,
   *   sqlTimestamp,
   *   readTimestamp,
   * })
   * ```
   */
  attach(db: Database, runner: TransactionRunner): this {
    this.#service = new MembershipService<R[number]>(this, db, runner)
    return this
  }

  /**
   * The membership service (specification section 5); available once a database is attached.
   *
   * @example
   * ```ts
   * const memberships = access.memberships
   * ```
   */
  get memberships(): MembershipService<R[number]> {
    if (!this.#service)
      throw new RuntimeException(
        'access-control: no database is attached; register the provider or call attach(db, runner) first'
      )
    return this.#service
  }

  /**
   * Builds a Bouncer ability map with one entry per permission key (section 8). `resolve` is read on every check, so
   * pass a closure over the request, for example `() => ctx.membership`.
   *
   * @example
   * ```ts
   * const abilities = access.abilities(() => ctx.membership)
   * ```
   */
  abilities(resolve: MembershipResolver): AbilityMap<P> {
    return createAbilities<P>(this, resolve)
  }

  /**
   * The client membership summary; its role may be a historical string outside this configuration.
   *
   * @example
   * ```ts
   * const summary = access.buildClientMembership(ctx.membership)
   * ```
   */
  buildClientMembership(
    membership: Membership | null | undefined
  ): ClientPayload<R[number], PermissionKeyOf<P>> | null {
    return buildClientPayload(this, membership) as ClientPayload<
      R[number],
      PermissionKeyOf<P>
    > | null
  }

  /**
   * Alias of `buildClientMembership`, returning null when there is no membership.
   *
   * @example
   * ```ts
   * const summary = access.clientPayload(ctx.membership)
   * ```
   */
  clientPayload(
    membership: Membership | null | undefined
  ): ClientPayload<R[number], PermissionKeyOf<P>> | null {
    return this.buildClientMembership(membership)
  }

  /**
   * The index of the role in `roles`, -1 when unknown.
   *
   * @example
   * ```ts
   * const adminRank = access.rank('admin')
   * ```
   */
  rank(role: string): number {
    return rules.rank(this.#matrix, role)
  }

  /**
   * Whether the role satisfies the permission key.
   *
   * @example
   * ```ts
   * const canInvite = access.can('admin', 'invitations:manage')
   * ```
   */
  can(role: string, key: string): boolean {
    return rules.can(this.#matrix, role, key)
  }

  /**
   * Lists the permission keys the role satisfies, in declaration order.
   *
   * @example
   * ```ts
   * const permissions = access.permissionsFor('viewer')
   * ```
   */
  permissionsFor(role: string): PermissionKeyOf<P>[] {
    return rules.listPermissionsForRole(this.#matrix, role) as PermissionKeyOf<P>[]
  }

  /**
   * Lists the roles the actor may assign (specification section 3).
   *
   * @example
   * ```ts
   * const roles = access.assignableRoles('admin')
   * ```
   */
  assignableRoles(actorRole: string): R[number][] {
    return rules.listAssignableRoles(this.#matrix, actorRole) as R[number][]
  }

  /**
   * Management decision (3.1).
   *
   * @example
   * ```ts
   * const decision = access.decideManagement({
   *   actorRole: 'admin',
   *   targetRole: 'viewer',
   *   isSelf: false,
   * })
   * ```
   */
  decideManagement(input: { actorRole: string; targetRole: string; isSelf: boolean }): RuleResult {
    return rules.decideManagement(this.#matrix, input)
  }

  /**
   * Alias of `decideManagement`, returning the full decision record. Inspect `allowed`.
   *
   * @example
   * ```ts
   * const { allowed } = access.canManage({
   *   actorRole: 'admin',
   *   targetRole: 'viewer',
   *   isSelf: false,
   * })
   * ```
   */
  canManage(input: { actorRole: string; targetRole: string; isSelf: boolean }): RuleResult {
    return this.decideManagement(input)
  }

  /**
   * Assignment decision (3.2).
   *
   * @example
   * ```ts
   * const decision = access.decideAssignment({
   *   actorRole: 'admin',
   *   targetRole: 'viewer',
   *   nextRole: 'admin',
   *   isSelf: false,
   * })
   * ```
   */
  decideAssignment(input: {
    actorRole: string
    targetRole: string
    nextRole: string
    isSelf: boolean
  }): RuleResult {
    return rules.decideAssignment(this.#matrix, input)
  }

  /**
   * Alias of `decideAssignment`, returning the full decision record. Inspect `allowed`.
   *
   * @example
   * ```ts
   * const { allowed } = access.canAssign({
   *   actorRole: 'admin',
   *   targetRole: 'viewer',
   *   nextRole: 'admin',
   *   isSelf: false,
   * })
   * ```
   */
  canAssign(input: {
    actorRole: string
    targetRole: string
    nextRole: string
    isSelf: boolean
  }): RuleResult {
    return this.decideAssignment(input)
  }

  /**
   * Identity predicate (3.4).
   *
   * @example
   * ```ts
   * const allowed = access.canAdministerIdentity(
   *   new Map([[12, 'admin']]),
   *   new Map([[12, 'viewer']]),
   *   false
   * )
   * ```
   */
  canAdministerIdentity(
    actorRoles: ReadonlyMap<ScopeKey, string>,
    targetRoles: ReadonlyMap<ScopeKey, string>,
    isSelf: boolean
  ): boolean {
    return rules.decideIdentity(this, actorRoles, targetRoles, isSelf).allowed
  }
}

/**
 * Validates the configuration (2.3) and returns the frozen `AccessControl` instance. The `const`
 * type parameters keep the role and permission literals for `RoleOf` and `PermissionKeyOf`.
 *
 * @example
 * ```ts
 * import { defineAccessControl } from '@kevinjohn/adonisjs-access-control'
 *
 * export default defineAccessControl({
 *   roles: ['viewer', 'admin'],
 *   users: { table: 'users', keyType: 'integer' },
 *   scope: { table: 'teams', keyType: 'integer' },
 *   permissions: {
 *     members: { list: 'viewer', manage: 'admin' },
 *     invitations: { manage: 'admin' },
 *   },
 * })
 * ```
 */
export function defineAccessControl<
  const R extends readonly [string, ...string[]],
  const P extends PermissionMap<R[number]>,
>(config: AccessControlConfig<R, P>): AccessControl<R, P> {
  return new AccessControl(config)
}

/**
 * Alias of `defineAccessControl` for an application config file.
 *
 * @example
 * ```ts
 * import { defineConfig } from '@kevinjohn/adonisjs-access-control'
 *
 * export default defineConfig({
 *   roles: ['viewer', 'admin'],
 *   users: { table: 'users', keyType: 'integer' },
 *   scope: { table: 'teams', keyType: 'integer' },
 *   permissions: {
 *     members: { list: 'viewer', manage: 'admin' },
 *     invitations: { manage: 'admin' },
 *   },
 * })
 * ```
 */
export const defineConfig = defineAccessControl
