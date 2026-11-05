// Type-level checks for the generated abilities under Bouncer's user narrowing; never run.
import { Bouncer } from '@adonisjs/bouncer'
import { defineAccessControl } from '../../index.js'
import type { ClientPayload, PermissionKeyOf, RoleOf } from '../../src/types.js'

interface User {
  id: number
  email: string
}

const config = defineAccessControl({
  roles: ['viewer', 'editor', 'owner'],
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  permissions: {
    project: { read: 'viewer', write: 'editor' },
    members: { list: 'editor', manage: 'editor' },
    invitations: { manage: 'editor' },
  },
})

const viewDashboard = Bouncer.ability((user: User) => user.email.length > 0)
const all = { viewDashboard, ...config.abilities(() => null) }
const bouncer = new Bouncer<User, typeof all>({ id: 1, email: 'a@b.c' }, all)

void bouncer.allows('project:write')
void bouncer.allows('viewDashboard')
// @ts-expect-error unknown key
void bouncer.allows('project:delete')
// @ts-expect-error dotted keys are not abilities
void bouncer.allows('project.write')

const payload: ClientPayload<RoleOf<typeof config>, PermissionKeyOf<typeof config>> | null =
  config.clientPayload(null)
if (payload) {
  const role: 'viewer' | 'editor' | 'owner' = payload.role
  const key:
    'project:read' | 'project:write' | 'members:list' | 'members:manage' | 'invitations:manage' =
    payload.permissions[0]
  void [role, key]
}
