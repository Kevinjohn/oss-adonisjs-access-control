// Pure rules (specification section 3). No AdonisJS imports; exposed on the AccessControl instance.
import type { AccessControl } from './define.js'
import type { RuleResult, ScopeKey } from './types.js'

/** The role tuple, owner role and lowest role per permission key, as validated by `define.ts`. */
export interface RoleMatrix {
  roles: readonly string[]
  ownerRole: string | undefined
  /** Permission key (`resource:action`) to the lowest role allowed, in declaration order. */
  minimumRoleByPermission: ReadonlyMap<string, string>
}

const deny = (
  code:
    | 'UNKNOWN_ROLE'
    | 'SELF_MANAGEMENT'
    | 'PERMISSION_DENIED'
    | 'OWNER_PROTECTED'
    | 'OWNER_ROLE_NOT_GRANTABLE'
    | 'RANK_TOO_LOW'
): RuleResult => ({
  allowed: false,
  code: `E_ACCESS_CONTROL_${code}`,
})

/** The index of the role in the tuple, -1 when unknown. */
export function rank(matrix: RoleMatrix, role: string): number {
  return matrix.roles.indexOf(role)
}

/** Whether the role satisfies the key: both known and the role ranks at or above the minimum. */
export function can(matrix: RoleMatrix, role: string, key: string): boolean {
  const roleRank = rank(matrix, role)
  const minimum = matrix.minimumRoleByPermission.get(key)
  if (roleRank < 0 || minimum === undefined) return false
  return roleRank >= rank(matrix, minimum)
}

/** Every key the role satisfies, in declaration order. */
export function listPermissionsForRole(matrix: RoleMatrix, role: string): string[] {
  return [...matrix.minimumRoleByPermission.keys()].filter((key) => can(matrix, role, key))
}

/** Roles the actor may assign: none without `members:manage`; else up to its rank, never the owner. */
export function listAssignableRoles(matrix: RoleMatrix, actorRole: string): string[] {
  if (!can(matrix, actorRole, 'members:manage')) return []
  const actorRank = rank(matrix, actorRole)
  return matrix.roles.filter((role, index) => index <= actorRank && role !== matrix.ownerRole)
}

/** Management truth table (3.1): first matching row wins. */
export function decideManagement(
  matrix: RoleMatrix,
  input: { actorRole: string; targetRole: string; isSelf: boolean }
): RuleResult {
  const actorRank = rank(matrix, input.actorRole)
  const targetRank = rank(matrix, input.targetRole)
  if (actorRank < 0 || targetRank < 0) return deny('UNKNOWN_ROLE')
  if (input.isSelf) return deny('SELF_MANAGEMENT')
  if (!can(matrix, input.actorRole, 'members:manage')) return deny('PERMISSION_DENIED')
  if (matrix.ownerRole !== undefined && input.targetRole === matrix.ownerRole)
    return deny('OWNER_PROTECTED')
  if (targetRank > actorRank) return deny('RANK_TOO_LOW')
  return { allowed: true }
}

/** Assignment (3.2): `decideManagement` first, then the next role's own rows. */
export function decideAssignment(
  matrix: RoleMatrix,
  input: { actorRole: string; targetRole: string; nextRole: string; isSelf: boolean }
): RuleResult {
  const manage = decideManagement(matrix, input)
  if (!manage.allowed) return manage
  const nextRank = rank(matrix, input.nextRole)
  if (nextRank < 0) return deny('UNKNOWN_ROLE')
  if (matrix.ownerRole !== undefined && input.nextRole === matrix.ownerRole)
    return deny('OWNER_ROLE_NOT_GRANTABLE')
  if (nextRank > rank(matrix, input.actorRole)) return deny('RANK_TOO_LOW')
  return { allowed: true }
}

type IdentityDecision =
  | RuleResult
  | {
      allowed: false
      code:
        | 'E_ACCESS_CONTROL_IDENTITY_TARGET_HAS_NO_MEMBERSHIPS'
        | 'E_ACCESS_CONTROL_MEMBERSHIP_REQUIRED'
    }

/**
 * The actor must manage the target in every scope. The actor map includes active memberships
 * only, and the target map includes all memberships.
 */
export function decideIdentity(
  access: Pick<AccessControl, 'decideManagement'>,
  actorRoles: ReadonlyMap<ScopeKey, string>,
  targetRoles: ReadonlyMap<ScopeKey, string>,
  isSelf: boolean
): IdentityDecision {
  if (targetRoles.size === 0)
    return { allowed: false, code: 'E_ACCESS_CONTROL_IDENTITY_TARGET_HAS_NO_MEMBERSHIPS' }
  if (isSelf) return { allowed: true }
  for (const [scope, targetRole] of targetRoles) {
    const actorRole = actorRoles.get(scope)
    if (actorRole === undefined)
      return { allowed: false, code: 'E_ACCESS_CONTROL_MEMBERSHIP_REQUIRED' }
    const decision = access.decideManagement({ actorRole, targetRole, isSelf: false })
    if (!decision.allowed) return decision
  }
  return { allowed: true }
}
