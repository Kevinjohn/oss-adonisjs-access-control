import { test } from '@japa/runner'
import { Bouncer } from '@adonisjs/bouncer'
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

interface User {
  id: number
  email: string
}

const alice: User = { id: 1, email: 'alice@example.com' }
const bob: User = { id: 2, email: 'bob@example.com' }

function membership(
  userId: number,
  role: string,
  status: 'active' | 'suspended' = 'active'
): Membership {
  const now = DateTime.utc()
  return { scopeId: 10, userId, role, status, createdAt: now, updatedAt: now }
}

/** An app ability kept beside the generated ones. */
const viewDashboard = Bouncer.ability((user: User) => user.email.endsWith('@example.com'))

/** A request-like holder: the resolver reads it on every check. */
function request(user: User | null, current: Membership | null = null) {
  const ctx = { membership: current as Membership | null }
  const bouncer = new Bouncer(() => user, {
    viewDashboard,
    ...config.abilities(() => ctx.membership),
  })
  return { ctx, bouncer }
}

test.group('abilities: Bouncer integration (spec 8)', () => {
  test('one ability per permission key, named by the key', ({ assert }) => {
    const generated = config.abilities(() => null)
    assert.deepEqual(Object.keys(generated), [...config.permissionKeys])
    for (const ability of Object.values(generated)) {
      assert.isFalse(ability.allowGuest)
      assert.isFunction(ability.execute)
    }
  })

  test('an editor is allowed project:write and denied project:archive', async ({ assert }) => {
    const { bouncer } = request(alice, membership(1, 'editor'))
    assert.isTrue(await bouncer.allows('project:write'))
    assert.isTrue(await bouncer.allows('project:read'))
    assert.isFalse(await bouncer.allows('project:archive'))
    assert.isFalse(await bouncer.allows('members:manage'))
    assert.isTrue(await bouncer.denies('project:archive'))
  })

  test('a membership set after the Bouncer is constructed is seen', async ({ assert }) => {
    const { ctx, bouncer } = request(alice)
    assert.isFalse(await bouncer.allows('project:read'))
    ctx.membership = membership(1, 'admin')
    assert.isTrue(await bouncer.allows('project:archive'))
    ctx.membership = membership(1, 'viewer')
    assert.isFalse(await bouncer.allows('project:archive'))
    assert.isTrue(await bouncer.allows('project:read'))
  })

  test('no membership, a suspended one and a stored role outside the tuple deny', async ({
    assert,
  }) => {
    assert.isFalse(await request(alice, null).bouncer.allows('project:read'))
    assert.isFalse(
      await request(alice, membership(1, 'owner', 'suspended')).bouncer.allows('project:read')
    )
    assert.isFalse(await request(alice, membership(1, 'ghost')).bouncer.allows('project:read'))
  })

  test('abilities reused with another subject deny', async ({ assert }) => {
    const { bouncer } = request(bob, membership(1, 'owner'))
    assert.isFalse(await bouncer.allows('project:read'))
    const stringKeys = request(
      { id: '1' as never, email: 'x@example.com' },
      membership(1, 'viewer')
    )
    assert.isTrue(await stringKeys.bouncer.allows('project:read'))
  })

  test('a guest is denied without the ability running', async ({ assert }) => {
    let executions = 0
    const probe = Bouncer.ability(() => {
      executions += 1
      return true
    })
    const guestAbilities = { probe, ...config.abilities(() => membership(1, 'owner')) }
    const bouncer = new Bouncer<User, typeof guestAbilities>(null, guestAbilities)
    assert.isFalse(await bouncer.allows('project:read'))
    assert.isFalse(await bouncer.allows('probe'))
    assert.equal(executions, 0)
  })

  test('concurrent requests in different scopes stay isolated', async ({ assert }) => {
    const first = request(alice, { ...membership(1, 'owner'), scopeId: 10 })
    const second = request(alice, { ...membership(1, 'viewer'), scopeId: 20 })
    const [a, b] = await Promise.all([
      first.bouncer.allows('project:archive'),
      second.bouncer.allows('project:archive'),
    ])
    assert.isTrue(a)
    assert.isFalse(b)
  })

  test('app abilities still work beside the generated ones', async ({ assert }) => {
    const { bouncer } = request(alice, membership(1, 'viewer'))
    assert.isTrue(await bouncer.allows('viewDashboard'))
    assert.isTrue(await bouncer.allows('project:read'))
    const outsider = request({ id: 3, email: 'eve@other.test' }, null)
    assert.isFalse(await outsider.bouncer.allows('viewDashboard'))
  })

  test('authorize throws a 403 authorization error', async ({ assert }) => {
    const { bouncer } = request(alice, membership(1, 'viewer'))
    await bouncer.authorize('project:read')
    try {
      await bouncer.authorize('project:write')
      assert.fail('expected authorize to throw')
    } catch (error) {
      assert.equal((error as { status?: number }).status, 403)
      assert.equal((error as { code?: string }).code, 'E_AUTHORIZATION_FAILURE')
    }
  })

  test('the Edge helpers accept colon keys', async ({ assert }) => {
    const { bouncer } = request(alice, membership(1, 'editor'))
    const edge = bouncer.edgeHelpers.bouncer
    assert.isTrue(await edge.can('project:write'))
    assert.isFalse(await edge.can('project:archive'))
    assert.isTrue(await edge.cannot('project:archive'))
    assert.isFalse(await edge.cannot('project:write'))
  })
})
