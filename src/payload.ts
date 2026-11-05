// The client payload (specification section 10).
import type { AccessControl } from './define.js'
import type { ClientPayload, Membership } from './types.js'

/** `null` for no membership or a suspended one; otherwise the role, its keys and assignable roles. */
export function clientPayload(
  access: AccessControl<any, any>,
  membership: Membership | null | undefined
): ClientPayload | null {
  if (!membership || membership.status !== 'active') return null
  return {
    scopeId: String(membership.scopeId),
    role: membership.role,
    permissions: access.permissionsFor(membership.role),
    assignableRoles: access.assignableRoles(membership.role),
  }
}
