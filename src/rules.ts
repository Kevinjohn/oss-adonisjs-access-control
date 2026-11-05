// Pure rules (specification section 3). No AdonisJS imports; exposed on the AccessControl instance.
import type { RuleResult, ScopeKey } from './types.js'

/** The role tuple, owner role and lowest role per permission key, as validated by `define.ts`. */
export interface RoleMatrix {
  roles: readonly string[]
  ownerRole: string | undefined
  /** Permission key (`resource:action`) to the lowest role allowed, in declaration order. */
  minimumRole: ReadonlyMap<string, string>
}

const allowed: RuleResult = { allowed: true }
const deny = (
  code: 'UNKNOWN_ROLE' | 'SELF_MANAGEMENT' | 'FORBIDDEN' | 'OWNER_PROTECTED' | 'RANK_TOO_LOW'
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
  const minimum = matrix.minimumRole.get(key)
  if (roleRank < 0 || minimum === undefined) return false
  return roleRank >= rank(matrix, minimum)
}

/** Every key the role satisfies, in declaration order. */
export function permissionsFor(matrix: RoleMatrix, role: string): string[] {
  return [...matrix.minimumRole.keys()].filter((key) => can(matrix, role, key))
}

/** Roles the actor may assign: none without `members:manage`; else up to its rank, never the owner. */
export function assignableRoles(matrix: RoleMatrix, actorRole: string): string[] {
  if (!can(matrix, actorRole, 'members:manage')) return []
  const actorRank = rank(matrix, actorRole)
  return matrix.roles.filter((role, index) => index <= actorRank && role !== matrix.ownerRole)
}

/** Management truth table (3.1): first matching row wins. */
export function canManage(
  matrix: RoleMatrix,
  input: { actorRole: string; targetRole: string; isSelf: boolean }
): RuleResult {
  const actorRank = rank(matrix, input.actorRole)
  const targetRank = rank(matrix, input.targetRole)
  if (actorRank < 0 || targetRank < 0) return deny('UNKNOWN_ROLE')
  if (input.isSelf) return deny('SELF_MANAGEMENT')
  if (!can(matrix, input.actorRole, 'members:manage')) return deny('FORBIDDEN')
  if (matrix.ownerRole !== undefined && input.targetRole === matrix.ownerRole)
    return deny('OWNER_PROTECTED')
  if (targetRank > actorRank) return deny('RANK_TOO_LOW')
  return allowed
}

/** Assignment (3.2): `canManage` first, then the next role's own rows. */
export function canAssign(
  matrix: RoleMatrix,
  input: { actorRole: string; targetRole: string; nextRole: string; isSelf: boolean }
): RuleResult {
  const manage = canManage(matrix, input)
  if (!manage.allowed) return manage
  const nextRank = rank(matrix, input.nextRole)
  if (nextRank < 0) return deny('UNKNOWN_ROLE')
  if (matrix.ownerRole !== undefined && input.nextRole === matrix.ownerRole)
    return deny('OWNER_PROTECTED')
  if (nextRank > rank(matrix, input.actorRole)) return deny('RANK_TOO_LOW')
  return allowed
}

/**
 * Identity predicate (3.4): the actor must be able to manage the target in every scope the target
 * belongs to. `actorRoles` holds the actor's active memberships; `targetRoles` all of the target's.
 */
export function canAdministerIdentity(
  matrix: RoleMatrix,
  actorRoles: ReadonlyMap<ScopeKey, string>,
  targetRoles: ReadonlyMap<ScopeKey, string>,
  isSelf: boolean
): boolean {
  if (targetRoles.size === 0) return false
  if (isSelf) return true
  for (const [scope, targetRole] of targetRoles) {
    const actorRole = actorRoles.get(scope)
    if (actorRole === undefined) return false
    if (!canManage(matrix, { actorRole, targetRole, isSelf: false }).allowed) return false
  }
  return true
}
