import { test } from '@japa/runner'
import { defineAccessControl, defineConfig } from '../index.ts'
import type { MembershipChange, PermissionKeyOf, RoleOf } from '../src/types.ts'

test('infers permission keys, roles and membership types', ({ expectTypeOf }) => {
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
  type AliasRole = RoleOf<typeof alias>
  type AliasKey = PermissionKeyOf<typeof alias>
  expectTypeOf<AliasRole>().toEqualTypeOf<'viewer' | 'admin'>()
  expectTypeOf<AliasKey>().toEqualTypeOf<'members:list' | 'members:manage' | 'invitations:manage'>()
  type AliasSummary = NonNullable<ReturnType<typeof alias.buildClientMembership>>
  expectTypeOf<AliasSummary['permissions'][number]>().toEqualTypeOf<AliasKey>()
  expectTypeOf<AliasSummary['assignableRoles'][number]>().toEqualTypeOf<AliasRole>()

  type Role = RoleOf<typeof config>
  type Key = PermissionKeyOf<typeof config>
  expectTypeOf<Role>().toEqualTypeOf<'viewer' | 'editor' | 'admin' | 'owner'>()
  expectTypeOf<Key>().toEqualTypeOf<
    AliasKey | 'project:read' | 'project:write' | 'project:archive'
  >()

  type Cleanup = Extract<MembershipChange<Role>, { type: 'membership.removed' | 'membership.left' }>
  expectTypeOf<Cleanup['role']>().toBeString()
  expectTypeOf<
    Extract<MembershipChange<Role>, { type: 'membership.added' }>['role']
  >().toEqualTypeOf<Role>()
  expectTypeOf<NonNullable<ReturnType<typeof config.buildClientMembership>>['role']>().toBeString()

  const mutableInput = {
    roles: ['viewer', 'owner'] as [string, string],
    ownerRole: 'owner',
    users: { table: 'users', keyType: 'integer' as const },
    scope: { table: 'teams', keyType: 'integer' as const },
    membershipsTable: 'team_memberships',
    permissions: {
      members: { list: 'viewer', manage: 'viewer' },
      invitations: { manage: 'viewer' },
    },
    onMembershipChanged: async () => {},
  }
  const resolved = defineAccessControl(mutableInput).config
  expectTypeOf<typeof resolved>().not.toBeAny()
  expectTypeOf(() => {
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
      permissions: {
        members: { list: 'viewer', manage: 'viewer' },
        invitations: { manage: 'viewer' },
      },
    })

    defineAccessControl({
      roles: ['viewer', 'owner'],
      users: { table: 'users', keyType: 'integer' },
      scope: { table: 'teams', keyType: 'integer' },
      permissions: {
        // @ts-expect-error a permission value must be a declared role
        members: { list: 'ceo', manage: 'viewer' },
        invitations: { manage: 'viewer' },
      },
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
  })
  type Active = NonNullable<Awaited<ReturnType<typeof config.memberships.findActive>>>
  expectTypeOf<Active['role']>().toEqualTypeOf<Role>()
  expectTypeOf<Active['status']>().toEqualTypeOf<'active'>()
})
