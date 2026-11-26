import { test } from '@japa/runner'
import { Bouncer } from '@adonisjs/bouncer'
import { defineAccessControl } from '../index.ts'
import type { ClientMembershipSummary, PermissionKeyOf, RoleOf } from '../src/types.ts'

test('infers Bouncer abilities and the client membership summary', ({ expectTypeOf }) => {
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

  type Permission =
    'project:read' | 'project:write' | 'members:list' | 'members:manage' | 'invitations:manage'
  expectTypeOf<keyof typeof all>().toEqualTypeOf<Permission | 'viewDashboard'>()
  expectTypeOf(() => {
    void bouncer.allows('project:write')
    void bouncer.allows('viewDashboard')
    // @ts-expect-error unknown key
    void bouncer.allows('project:delete')
    // @ts-expect-error dotted keys are not abilities
    void bouncer.allows('project.write')
  })

  const summary = config.buildClientMembership(null)
  expectTypeOf(summary).toEqualTypeOf<ClientMembershipSummary<
    RoleOf<typeof config>,
    PermissionKeyOf<typeof config>
  > | null>()
  expectTypeOf<NonNullable<typeof summary>['role']>().toBeString()
  expectTypeOf<NonNullable<typeof summary>['permissions'][number]>().toEqualTypeOf<Permission>()
})
