// Type-level checks for defineAccessControl inference; compiled by `pnpm typecheck`, never run.
import { defineAccessControl, defineConfig } from '../../index.js'
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

const alias = defineConfig({
  roles: ['viewer', 'admin'],
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  permissions: { members: { list: 'admin', manage: 'admin' }, invitations: { manage: 'admin' } },
})
const aliasRole: RoleOf<typeof alias> = 'admin'
// @ts-expect-error alias keeps role literals
const badAliasRole: RoleOf<typeof alias> = 'owner'
const aliasKey: PermissionKeyOf<typeof alias> = 'members:list'
// @ts-expect-error alias keeps permission literals
const badAliasKey: PermissionKeyOf<typeof alias> = 'project:read'
const aliasSummary = alias.buildClientMembership(null)
if (aliasSummary) {
  const key: PermissionKeyOf<typeof alias> = aliasSummary.permissions[0]
  const role: RoleOf<typeof alias> = aliasSummary.assignableRoles[0]
  void [key, role]
}
void [aliasRole, badAliasRole, aliasKey, badAliasKey]

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
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'integer' as const },
  scope: { table: 'teams', keyType: 'integer' as const },
  membershipsTable: 'team_memberships',
  permissions: { members: { list: 'viewer', manage: 'viewer' }, invitations: { manage: 'viewer' } },
  onMembershipChanged: async () => {},
}
const resolved = defineAccessControl(mutableInput).config
mutableInput.roles[0] = 'viewer'
mutableInput.ownerRole = 'viewer'
mutableInput.users.table = 'people'
mutableInput.scope.table = 'groups'
mutableInput.membershipsTable = 'memberships'
mutableInput.permissions.members.list = 'owner'
mutableInput.onMembershipChanged = async () => {}
// @ts-expect-error resolved roles are frozen even when input tuple is mutable
resolved.roles[0] = 'viewer'
// @ts-expect-error resolved roles cannot be replaced
resolved.roles = ['viewer', 'owner']
// @ts-expect-error resolved owner role cannot be replaced
resolved.ownerRole = 'owner'
// @ts-expect-error resolved users settings are frozen
resolved.users.table = 'people'
// @ts-expect-error resolved users settings cannot be replaced
resolved.users = { table: 'people', keyType: 'integer' }
// @ts-expect-error resolved scope settings are frozen
resolved.scope.table = 'groups'
// @ts-expect-error resolved scope settings cannot be replaced
resolved.scope = { table: 'groups', keyType: 'integer' }
// @ts-expect-error resolved memberships table cannot be replaced
resolved.membershipsTable = 'memberships'
// @ts-expect-error resolved permission entries are frozen
resolved.permissions.members.list = 'owner'
// @ts-expect-error resolved permissions cannot be replaced
resolved.permissions = mutableInput.permissions
// @ts-expect-error resolved membership hook cannot be replaced
resolved.onMembershipChanged = async () => {}

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

async function inspectActiveMembership() {
  const active = await config.memberships.findActive(1, 2)
  if (!active) return
  const configuredRole: Role = active.role
  const status: 'active' = active.status
  void [configuredRole, status]
}
void inspectActiveMembership
