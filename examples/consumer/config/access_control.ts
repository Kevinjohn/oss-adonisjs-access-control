import { defineAccessControl } from '@kevinjohn/adonisjs-access-control'

/** Roles, lowest first; the owner is last. Permission values are the lowest role allowed. */
export default defineAccessControl({
  roles: ['viewer', 'editor', 'admin', 'owner'],
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  membershipsTable: 'memberships',
  permissions: {
    project: { read: 'viewer', write: 'editor', archive: 'admin' },
    members: { list: 'admin', manage: 'admin' },
    invitations: { manage: 'admin' },
  },
})
