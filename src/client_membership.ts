// The client membership summary (specification section 10).
import type { AccessControl } from './define.ts'
import type { ClientMembershipSummary, Membership } from './types.ts'

/** `null` for no membership or a suspended one; otherwise the role, its keys and assignable roles. */
export function buildClientMembershipSummary(
  access: AccessControl<any, any>,
  membership: Membership | null | undefined
): ClientMembershipSummary | null {
  if (!membership || membership.status !== 'active') return null
  return {
    scopeId: String(membership.scopeId),
    role: membership.role,
    permissions: access.permissionsFor(membership.role),
    assignableRoles: access.assignableRoles(membership.role),
  }
}
