// Type-level checks for defineAccessControl inference; compiled by `pnpm typecheck`, never run.
import { defineAccessControl } from '../../index.js'
import type { PermissionKeyOf, RoleOf } from '../../src/types.js'

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

const role: Role = 'editor'
const key: Key = 'project:write'
// @ts-expect-error unknown role
const badRole: Role = 'ceo'
// @ts-expect-error unknown key
const badKey: Key = 'project:delete'
// @ts-expect-error dotted keys are not permission keys
const dottedKey: Key = 'project.write'

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
