import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { defineAccessControl } from '../index.js'
import type { Membership } from '../src/types.js'

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

function membership(role: string, status: 'active' | 'suspended' = 'active'): Membership {
  const now = DateTime.utc()
  return { scopeId: 42, userId: 7, role, status, createdAt: now, updatedAt: now }
}

test.group('client payload (spec 10)', () => {
  test('null in, null out; suspended is null', ({ assert }) => {
    assert.isNull(config.clientPayload(null))
    assert.isNull(config.clientPayload(undefined))
    assert.isNull(config.clientPayload(membership('owner', 'suspended')))
  })

  test('an editor payload has a string scopeId, its keys and no assignable roles', ({ assert }) => {
    assert.deepEqual(config.clientPayload(membership('editor')), {
      scopeId: '42',
      role: 'editor',
      permissions: ['project:read', 'project:write'],
      assignableRoles: [],
    })
  })

  test('an admin payload lists assignable roles below the owner', ({ assert }) => {
    assert.deepEqual(config.clientPayload(membership('admin')), {
      scopeId: '42',
      role: 'admin',
      permissions: [
        'project:read',
        'project:write',
        'project:archive',
        'members:list',
        'members:manage',
        'invitations:manage',
      ],
      assignableRoles: ['viewer', 'editor', 'admin'],
    })
    assert.deepEqual(config.clientPayload({ ...membership('ghost'), scopeId: 'abc' }), {
      scopeId: 'abc',
      role: 'ghost',
      permissions: [],
      assignableRoles: [],
    })
  })
})
