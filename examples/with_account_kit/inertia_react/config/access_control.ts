import { defineAccessControl } from '@kevinjohn/adonisjs-access-control'

/**
 * Roles from lowest to highest; the owner role, when set, is the last one. Each permission key
 * names the lowest role allowed. The keys members:list, members:manage and invitations:manage
 * are required. Renaming or removing a role needs a data migration; see the roles guide.
 */
export default defineAccessControl({
  roles: ['viewer', 'editor', 'admin', 'owner'],
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  membershipsTable: 'memberships',
  permissions: {
    team: { read: 'viewer', write: 'editor' },
    members: { list: 'viewer', manage: 'admin' },
    invitations: { manage: 'admin' },
  },
  /**
   * Runs inside the write transaction after each membership change, for audit rows or
   * notifications queued on commit.
   */
  // onMembershipChanged: async (event, trx) => {},
})
