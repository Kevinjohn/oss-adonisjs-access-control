import type { Database } from '@adonisjs/lucid/database'
import { AccessControlError } from './errors.js'
import { MembershipService } from './memberships.js'
import { sqlIdentifierPattern } from './identifiers.js'
import * as rules from './rules.js'
import type { RoleMatrix } from './rules.js'
import type {
  AccessControlConfig,
  KeyType,
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

function invalid(detail: string): AccessControlError {
  return new AccessControlError('E_ACCESS_CONTROL_INVALID_CONFIG', {
    message: `access-control: invalid configuration: ${detail}`,
  })
}

function assertIdentifier(name: string, value: unknown): void {
  if (typeof value !== 'string' || !sqlIdentifierPattern.test(value))
    throw invalid(`${name} ${JSON.stringify(value)} is not a plain SQL identifier`)
}

function assertKeyType(name: string, value: unknown): void {
  if (!keyTypes.includes(value as KeyType))
    throw invalid(`${name} ${JSON.stringify(value)} must be integer, string or uuid`)
}

/** Validation per specification 2.3; returns the matrix the rules read. */
function validate(config: AccessControlConfig<any, any>): RoleMatrix {
  const roles: unknown = config.roles
  if (!Array.isArray(roles) || roles.length === 0)
    throw invalid('roles must list at least one role')
  for (const role of roles) {
    if (typeof role !== 'string' || !rolePattern.test(role) || role.length > 32)
      throw invalid(
        `role name ${JSON.stringify(role)} must match ^[a-z][a-z0-9_-]*$ and be at most 32 characters`
      )
    if (roles.indexOf(role) !== roles.lastIndexOf(role)) throw invalid(`duplicate role "${role}"`)
  }
  const permissions: unknown = config.permissions
  if (typeof permissions !== 'object' || permissions === null)
    throw invalid('permissions must be an object of resources')
  const minimumRole = new Map<string, string>()
  for (const [resource, actions] of Object.entries(permissions as Record<string, unknown>)) {
    if (!namePattern.test(resource))
      throw invalid(`resource name ${JSON.stringify(resource)} must match ^[a-z][a-zA-Z0-9]*$`)
    if (typeof actions !== 'object' || actions === null)
      throw invalid(`resource "${resource}" must map actions to roles`)
    for (const [action, role] of Object.entries(actions as Record<string, unknown>)) {
      if (!namePattern.test(action))
        throw invalid(`action name ${JSON.stringify(action)} must match ^[a-z][a-zA-Z0-9]*$`)
      if (typeof role !== 'string' || !roles.includes(role))
        throw invalid(`permission ${resource}:${action} names ${JSON.stringify(role)}, not a role`)
      minimumRole.set(`${resource}:${action}`, role)
    }
  }
  for (const key of reservedKeys)
    if (!minimumRole.has(key)) throw invalid(`reserved key ${key} is missing`)
  const ownerRole: unknown = config.ownerRole
  if (ownerRole !== undefined) {
    if (roles.length < 2) throw invalid('ownerRole needs at least two roles')
    if (ownerRole !== roles[roles.length - 1])
      throw invalid(`ownerRole ${JSON.stringify(ownerRole)} must be the last role`)
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
    minimumRole,
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
 */
export class AccessControl<
  const R extends readonly [string, ...string[]] = readonly [string, ...string[]],
  const P extends PermissionMap<R[number]> = PermissionMap<R[number]>,
> {
  /** The validated, frozen configuration. */
  readonly config: ResolvedAccessControlConfig<R, P>
  /** Roles, lowest rank first. */
  readonly roles: R
  /** The owner role, when owner rules are enabled. */
  readonly ownerRole: R[number] | undefined
  /** Every permission key, in declaration order. */
  readonly permissionKeys: readonly PermissionKeyOf<P>[]
  readonly #matrix: RoleMatrix
  #service: MembershipService<R[number]> | undefined

  constructor(config: AccessControlConfig<R, P>) {
    this.#matrix = validate(config)
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
    })
    this.roles = this.config.roles
    this.ownerRole = this.config.ownerRole
    this.permissionKeys = Object.freeze([
      ...this.#matrix.minimumRole.keys(),
    ] as PermissionKeyOf<P>[])
    Object.freeze(this)
  }

  /**
   * Binds the database and transaction runner; the provider calls this at boot. The instance
   * stays frozen, so the binding lives in a private field.
   */
  attach(db: Database, runner: TransactionRunner): this {
    this.#service = new MembershipService<R[number]>(this, db, runner)
    return this
  }

  /** The membership service (specification section 5); available once a database is attached. */
  get memberships(): MembershipService<R[number]> {
    if (!this.#service)
      throw new AccessControlError('E_ACCESS_CONTROL_INVALID_CONFIG', {
        message:
          'access-control: no database is attached; register the provider or call attach(db, runner) first',
      })
    return this.#service
  }

  /** The index of the role in `roles`, -1 when unknown. */
  rank(role: string): number {
    return rules.rank(this.#matrix, role)
  }

  /** Whether the role satisfies the permission key. */
  can(role: string, key: string): boolean {
    return rules.can(this.#matrix, role, key)
  }

  /** Every key the role satisfies, in declaration order. */
  permissionsFor(role: string): PermissionKeyOf<P>[] {
    return rules.permissionsFor(this.#matrix, role) as PermissionKeyOf<P>[]
  }

  /** Roles the actor may assign (specification section 3). */
  assignableRoles(actorRole: string): R[number][] {
    return rules.assignableRoles(this.#matrix, actorRole) as R[number][]
  }

  /** Management truth table (3.1). */
  canManage(input: { actorRole: string; targetRole: string; isSelf: boolean }): RuleResult {
    return rules.canManage(this.#matrix, input)
  }

  /** Assignment rules (3.2). */
  canAssign(input: {
    actorRole: string
    targetRole: string
    nextRole: string
    isSelf: boolean
  }): RuleResult {
    return rules.canAssign(this.#matrix, input)
  }

  /** Identity predicate (3.4). */
  canAdministerIdentity(
    actorRoles: ReadonlyMap<ScopeKey, string>,
    targetRoles: ReadonlyMap<ScopeKey, string>,
    isSelf: boolean
  ): boolean {
    return rules.canAdministerIdentity(this.#matrix, actorRoles, targetRoles, isSelf)
  }
}

/**
 * Validates the configuration (2.3) and returns the frozen `AccessControl` instance. The `const`
 * type parameters keep the role and permission literals for `RoleOf` and `PermissionKeyOf`.
 */
export function defineAccessControl<
  const R extends readonly [string, ...string[]],
  const P extends PermissionMap<R[number]>,
>(config: AccessControlConfig<R, P>): AccessControl<R, P> {
  return new AccessControl(config)
}
