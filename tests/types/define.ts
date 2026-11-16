// Type-level checks for defineAccessControl inference; compiled by `pnpm typecheck`, never run.
import { defineAccessControl } from '../../index.js'
import type { MembershipEvent, PermissionKeyOf, RoleOf } from '../../src/types.js'

const config = defineAccessControl({
  roles: ['viewer', 'editor', 'admin', 'owner'],
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  permissions: {
    project: { read: 'viewer', write: 'editor', archive: 'admin' },
    members: { list: 'admin', manage: 'admin' },
    invitations: { manage: 'admin' },
  },
})

type Role = RoleOf<typeof config>
type Key = PermissionKeyOf<typeof config>

function inspectEvent(event: MembershipEvent<Role>): void {
  if (event.type === 'membership.removed' || event.type === 'membership.left') {
    const storedRole: string = event.role
    // @ts-expect-error cleanup can expose a historical role
    const configuredRole: Role = event.role
    void [storedRole, configuredRole]
  }
  if (event.type === 'membership.added') {
    const configuredRole: Role = event.role
    void configuredRole
  }
}
void inspectEvent

const role: Role = 'editor'
const key: Key = 'project:write'
const payload = config.clientPayload({} as import('../../src/types.js').Membership)
if (payload) {
  const storedRole: string = payload.role
  // @ts-expect-error stored roles need not be in the current configuration
  const configuredRole: Role = payload.role
  void [storedRole, configuredRole]
}
// @ts-expect-error unknown role
const badRole: Role = 'ceo'
// @ts-expect-error unknown key
const badKey: Key = 'project:delete'
// @ts-expect-error dotted keys are not permission keys
const dottedKey: Key = 'project.write'

const mutableInput = {
  roles: ['viewer', 'owner'] as [string, string],
  users: { table: 'users', keyType: 'integer' as const },
  scope: { table: 'teams', keyType: 'integer' as const },
  permissions: { members: { list: 'viewer', manage: 'viewer' }, invitations: { manage: 'viewer' } },
}
const resolved = defineAccessControl(mutableInput).config
mutableInput.roles[0] = 'viewer'
mutableInput.users.table = 'people'
mutableInput.scope.table = 'groups'
mutableInput.permissions.members.list = 'owner'
// @ts-expect-error resolved roles are frozen even when input tuple is mutable
resolved.roles[0] = 'viewer'
// @ts-expect-error resolved users settings are frozen
resolved.users.table = 'people'
// @ts-expect-error resolved scope settings are frozen
resolved.scope.table = 'groups'
// @ts-expect-error resolved permission entries are frozen
resolved.permissions.members.list = 'owner'

defineAccessControl({
  roles: ['viewer', 'owner'],
  // @ts-expect-error the owner role must be one of the roles
  ownerRole: 'ceo',
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  permissions: { members: { list: 'viewer', manage: 'viewer' }, invitations: { manage: 'viewer' } },
})

defineAccessControl({
  roles: ['viewer', 'owner'],
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  // @ts-expect-error a permission value must be a declared role
  permissions: { members: { list: 'ceo', manage: 'viewer' }, invitations: { manage: 'viewer' } },
})

defineAccessControl({
  roles: ['viewer', 'owner'],
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  // @ts-expect-error the reserved keys are required
  permissions: { members: { list: 'viewer' }, invitations: { manage: 'viewer' } },
})

// @ts-expect-error grant requires the application's transaction
void config.memberships.grant({ scopeId: 1, userId: 2, role: 'editor' })

void [role, key, badRole, badKey, dottedKey]
