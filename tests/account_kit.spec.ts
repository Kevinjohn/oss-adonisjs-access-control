// Specification section 9: the Account Kit callbacks over a booted application.
import { test } from '@japa/runner'
import type { AccountUser, Invitation, Trx } from '@kevinjohn/adonisjs-account-kit'
import { withInvitationEvidence } from '@kevinjohn/adonisjs-account-kit/admission'
import { accessControlKitCallbacks } from '../account_kit/main.js'
import { AccessControl } from '../index.js'
import type { MembershipEvent } from '../src/types.js'
import { bootTestApp, type TestApp } from './helpers/app.js'
import { codeOf, permissions } from './helpers/fixture.js'

// Created before any application exists, as config/account_kit.ts does.
const callbacks = accessControlKitCallbacks()
const events: MembershipEvent<string>[] = []

function user(id: number): AccountUser {
  return { id, email: `user${id}@example.com` } as unknown as AccountUser
}

function invitation(input: {
  id: number
  scope: string | null
  role: string
  email?: string
}): Invitation {
  const scoped = {
    id: input.id,
    email: input.email ?? `invited${input.id}@example.com`,
    role: input.role,
    inviterId: null,
    expiresAt: null as never,
    scope: input.scope,
  } as unknown as Invitation
  return scoped
}

function idOf(rows: unknown[]): number {
  const [row] = rows
  return Number(typeof row === 'object' && row !== null ? (row as { id: unknown }).id : row)
}

async function fixture(booted: TestApp) {
  const access = await booted.app.container.make(AccessControl)
  const createUser = async () =>
    idOf(await booted.db.table(booted.names.users).returning('id').insert({ name: 'u' }))
  const createScope = async () =>
    idOf(await booted.db.table(booted.names.scope).returning('id').insert({ name: 's' }))
  const inTrx = <T>(run: (trx: Trx) => Promise<T>) => booted.db.transaction(run)
  const countScopes = async () => {
    const [row] = await booted.db.from(booted.names.scope).count('* as total')
    return Number(row.total)
  }
  const membershipRows = (userId: number) =>
    booted.db.from(booted.names.memberships).where('user_id', userId).orderBy('scope_id', 'asc')
  return { access, createUser, createScope, inTrx, membershipRows, countScopes }
}

test.group('Account Kit callbacks: authorize (spec 9)', (group) => {
  let booted: TestApp
  let f: Awaited<ReturnType<typeof fixture>>
  group.setup(async () => {
    booted = await bootTestApp({
      async onMembershipChanged(event) {
        events.push(event)
      },
    })
    f = await fixture(booted)
    return () => booted.close()
  })

  test('invite: allowed per rank, denied for the owner role, unknown roles and ranks above the actor', async ({
    assert,
  }) => {
    const scope = await f.createScope()
    const [owner, admin, editor] = await Promise.all([
      f.createUser(),
      f.createUser(),
      f.createUser(),
    ])
    await f.access.memberships.createFirstMember({ scopeId: scope, userId: owner })
    await f.access.memberships.add({
      actor: { id: owner },
      scopeId: scope,
      userId: admin,
      role: 'admin',
    })
    await f.access.memberships.add({
      actor: { id: owner },
      scopeId: scope,
      userId: editor,
      role: 'editor',
    })
    const context = { scope: String(scope) }
    assert.isTrue(await callbacks.authorize.invite(user(owner), 'admin', context))
    assert.isTrue(await callbacks.authorize.invite(user(owner), 'viewer', context))
    assert.isTrue(await callbacks.authorize.invite(user(admin), 'admin', context))
    assert.isTrue(await callbacks.authorize.invite(user(admin), 'editor', context))
    assert.isFalse(await callbacks.authorize.invite(user(owner), 'owner', context))
    assert.isFalse(await callbacks.authorize.invite(user(owner), 'ceo', context))
    assert.isFalse(await callbacks.authorize.invite(user(editor), 'viewer', context))
  })

  test('invite: denied without a scope, with a malformed or unknown scope, and for a non-member or suspended member', async ({
    assert,
  }) => {
    const scope = await f.createScope()
    const other = await f.createScope()
    const [owner, outsider, suspended] = await Promise.all([
      f.createUser(),
      f.createUser(),
      f.createUser(),
    ])
    await f.access.memberships.createFirstMember({ scopeId: scope, userId: owner })
    await f.access.memberships.add({
      actor: { id: owner },
      scopeId: scope,
      userId: suspended,
      role: 'admin',
    })
    await f.access.memberships.setStatus({
      actor: { id: owner },
      scopeId: scope,
      userId: suspended,
      status: 'suspended',
    })
    assert.isFalse(await callbacks.authorize.invite(user(owner), 'editor'))
    assert.isFalse(await callbacks.authorize.invite(user(owner), 'editor', { scope: null }))
    assert.isFalse(await callbacks.authorize.invite(user(owner), 'editor', { scope: 'not-a-team' }))
    assert.isFalse(await callbacks.authorize.invite(user(owner), 'editor', { scope: '999999' }))
    assert.isFalse(
      await callbacks.authorize.invite(user(owner), 'editor', { scope: String(other) })
    )
    assert.isFalse(
      await callbacks.authorize.invite(user(outsider), 'editor', { scope: String(scope) })
    )
    assert.isFalse(
      await callbacks.authorize.invite(user(suspended), 'editor', { scope: String(scope) })
    )
  })

  test('invite reads through context.trx: a membership created in the transaction counts', async ({
    assert,
  }) => {
    const scope = await f.createScope()
    const owner = await f.createUser()
    await f.inTrx(async (trx) => {
      await f.access.memberships.createFirstMember({ scopeId: scope, userId: owner, trx })
      assert.isTrue(
        await callbacks.authorize.invite(user(owner), 'editor', { scope: String(scope), trx })
      )
      await trx.rollback()
    })
    assert.isFalse(
      await callbacks.authorize.invite(user(owner), 'editor', { scope: String(scope) })
    )
  })

  test('manageInvitation and listInvitations: per invitation scope and role, per context scope', async ({
    assert,
  }) => {
    const scope = await f.createScope()
    const other = await f.createScope()
    const [owner, admin, viewer] = await Promise.all([
      f.createUser(),
      f.createUser(),
      f.createUser(),
    ])
    await f.access.memberships.createFirstMember({ scopeId: scope, userId: owner })
    await f.access.memberships.add({
      actor: { id: owner },
      scopeId: scope,
      userId: admin,
      role: 'admin',
    })
    await f.access.memberships.add({
      actor: { id: owner },
      scopeId: scope,
      userId: viewer,
      role: 'viewer',
    })
    const inScope = (role: string) => invitation({ id: 1, scope: String(scope), role })
    assert.isTrue(await callbacks.authorize.manageInvitation(user(owner), inScope('admin')))
    assert.isTrue(await callbacks.authorize.manageInvitation(user(admin), inScope('admin')))
    assert.isFalse(await callbacks.authorize.manageInvitation(user(admin), inScope('owner')))
    assert.isFalse(await callbacks.authorize.manageInvitation(user(admin), inScope('ceo')))
    assert.isFalse(await callbacks.authorize.manageInvitation(user(viewer), inScope('viewer')))
    assert.isFalse(
      await callbacks.authorize.manageInvitation(
        user(owner),
        invitation({ id: 2, scope: null, role: 'editor' })
      )
    )
    assert.isFalse(
      await callbacks.authorize.manageInvitation(
        user(owner),
        invitation({ id: 3, scope: String(other), role: 'editor' })
      )
    )
    assert.isTrue(await callbacks.authorize.listInvitations(user(owner), { scope: String(scope) }))
    assert.isTrue(await callbacks.authorize.listInvitations(user(admin), { scope: String(scope) }))
    assert.isFalse(
      await callbacks.authorize.listInvitations(user(viewer), { scope: String(scope) })
    )
    assert.isFalse(await callbacks.authorize.listInvitations(user(owner), { scope: String(other) }))
    assert.isFalse(await callbacks.authorize.listInvitations(user(owner), { scope: null }))
    assert.isFalse(await callbacks.authorize.listInvitations(user(owner)))
  })
})

test.group('Account Kit callbacks: acceptance, deletion and export (spec 9)', (group) => {
  let booted: TestApp
  let f: Awaited<ReturnType<typeof fixture>>
  group.setup(async () => {
    booted = await bootTestApp({
      async onMembershipChanged(event) {
        events.push(event)
      },
    })
    f = await fixture(booted)
    const schema = booted.db.connection().schema
    if (!(await schema.hasTable('account_admissions'))) {
      await schema.createTable('account_admissions', (table) => {
        table.increments('id')
        table.integer('user_id').nullable().unique()
        table.string('bootstrap_email', 254).nullable().unique()
        table.timestamp('requested_at', { useTz: true, precision: 3 }).nullable()
        table.integer('invitation_id').nullable()
        table.string('invited_email', 254).nullable()
        table.string('invited_role', 64).nullable()
        table.string('invitation_source', 16).nullable()
        table.timestamp('invitation_recorded_at', { useTz: true, precision: 3 }).nullable()
        table.string('approval_status', 16).nullable()
        table.integer('approval_actor_id').nullable()
        table.timestamp('approval_decided_at', { useTz: true, precision: 3 }).nullable()
        table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable()
        table.timestamp('updated_at', { useTz: true, precision: 3 }).notNullable()
      })
    }
    return async () => {
      await booted.db.connection().schema.dropTableIfExists('account_admissions')
      await booted.close()
    }
  })
  group.each.setup(() => {
    events.length = 0
  })

  test('one address invited to two scopes: two memberships, events in scope order; a null scope adds nothing', async ({
    assert,
  }) => {
    const [a, b] = await Promise.all([f.createScope(), f.createScope()])
    const [owner, invited] = await Promise.all([f.createUser(), f.createUser()])
    await f.access.memberships.createFirstMember({ scopeId: a, userId: owner })
    await f.access.memberships.createFirstMember({ scopeId: b, userId: owner })
    events.length = 0
    const [first, second] = [a, b].sort((x, y) => (String(x) < String(y) ? -1 : 1))
    await f.inTrx(async (trx) => {
      await callbacks.onInvitationAccepted(
        user(invited),
        invitation({ id: 10, scope: null, role: 'admin' }),
        trx
      )
      await callbacks.onInvitationAccepted(
        user(invited),
        invitation({ id: 11, scope: String(first), role: 'editor' }),
        trx
      )
      await callbacks.onInvitationAccepted(
        user(invited),
        invitation({ id: 12, scope: String(second), role: 'admin' }),
        trx
      )
    })
    const rows = await f.membershipRows(invited)
    assert.deepEqual(
      rows.map((row) => [Number(row.scope_id), row.role]),
      [
        [first, 'editor'],
        [second, 'admin'],
      ].sort((x, y) => Number(x[0]) - Number(y[0]))
    )
    assert.deepEqual(
      events.map((event) => [
        event.type,
        event.scopeId,
        'invitationId' in event ? event.invitationId : null,
      ]),
      [
        ['membership.invitation_accepted', first, 11],
        ['membership.invitation_accepted', second, 12],
      ]
    )
  })

  test('acceptance fails as a whole for a deleted scope, a renamed role, the owner role or an existing membership', async ({
    assert,
  }) => {
    const scope = await f.createScope()
    const [owner, member, invited] = await Promise.all([
      f.createUser(),
      f.createUser(),
      f.createUser(),
    ])
    await f.access.memberships.createFirstMember({ scopeId: scope, userId: owner })
    await f.access.memberships.add({
      actor: { id: owner },
      scopeId: scope,
      userId: member,
      role: 'editor',
    })
    events.length = 0
    const accept = (userId: number, input: { scope: string; role: string }) =>
      codeOf(
        f.inTrx(async (trx) => {
          await trx.table(booted.names.scope).insert({ name: 'created in the same transaction' })
          await callbacks.onInvitationAccepted(user(userId), invitation({ id: 20, ...input }), trx)
        })
      )
    const scopesBefore = await f.countScopes()
    assert.equal(
      await accept(invited, { scope: '999999', role: 'editor' }),
      'E_ACCESS_CONTROL_SCOPE_NOT_FOUND'
    )
    assert.equal(
      await accept(invited, { scope: String(scope), role: 'ceo' }),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    assert.equal(
      await accept(invited, { scope: String(scope), role: 'owner' }),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    assert.equal(
      await accept(member, { scope: String(scope), role: 'admin' }),
      'E_ACCESS_CONTROL_ALREADY_MEMBER'
    )
    const scopesAfter = await f.countScopes()
    assert.equal(scopesAfter, scopesBefore)
    assert.lengthOf(await f.membershipRows(invited), 0)
    assert.lengthOf(events, 0)
  })

  test('the app callback runs after the package, in the same transaction, for every acceptance', async ({
    assert,
  }) => {
    const scope = await f.createScope()
    const [owner, invited] = await Promise.all([f.createUser(), f.createUser()])
    await f.access.memberships.createFirstMember({ scopeId: scope, userId: owner })
    const seen: Array<[number, number, string | null]> = []
    const composed = accessControlKitCallbacks({
      async onInvitationAccepted(accepted, inv, trx) {
        const membership = await f.access.memberships.find(scope, accepted.id, trx)
        seen.push([inv.id, Number(accepted.id), membership?.role ?? null])
      },
    })
    await f.inTrx(async (trx) => {
      await composed.onInvitationAccepted(
        user(invited),
        invitation({ id: 30, scope: null, role: 'x' }),
        trx
      )
      await composed.onInvitationAccepted(
        user(invited),
        invitation({ id: 31, scope: String(scope), role: 'editor' }),
        trx
      )
    })
    assert.deepEqual(seen, [
      [30, invited, null],
      [31, invited, 'editor'],
    ])
  })

  test('composes with withInvitationEvidence: evidence row and membership in one transaction', async ({
    assert,
  }) => {
    const scope = await f.createScope()
    const [owner, invited] = await Promise.all([f.createUser(), f.createUser()])
    await f.access.memberships.createFirstMember({ scopeId: scope, userId: owner })
    const onInvitationAccepted = withInvitationEvidence(callbacks.onInvitationAccepted)
    await f.inTrx((trx) =>
      onInvitationAccepted(
        user(invited),
        invitation({ id: 40, scope: String(scope), role: 'viewer' }),
        trx
      )
    )
    const evidence = await booted.db.from('account_admissions').where('user_id', invited).first()
    assert.include(evidence, {
      invitation_id: 40,
      invited_role: 'viewer',
      invitation_source: 'invitation',
    })
    assert.deepInclude(await f.access.memberships.find(scope, invited), {
      role: 'viewer',
      status: 'active',
    })
  })

  test('deletion: refused for an active owner; otherwise every membership goes and the user row can be deleted', async ({
    assert,
  }) => {
    const [a, b] = await Promise.all([f.createScope(), f.createScope()])
    const [owner, member] = await Promise.all([f.createUser(), f.createUser()])
    await f.access.memberships.createFirstMember({ scopeId: a, userId: owner })
    await f.access.memberships.createFirstMember({ scopeId: b, userId: owner })
    await f.access.memberships.add({
      actor: { id: owner },
      scopeId: a,
      userId: member,
      role: 'editor',
    })
    await f.access.memberships.add({
      actor: { id: owner },
      scopeId: b,
      userId: member,
      role: 'admin',
    })
    assert.equal(
      await codeOf(f.inTrx((trx) => callbacks.onAccountDeletingTransaction(user(owner), trx))),
      'E_ACCESS_CONTROL_LAST_OWNER'
    )
    assert.lengthOf(await f.membershipRows(owner), 2)
    events.length = 0
    await f.inTrx(async (trx) => {
      await callbacks.onAccountDeletingTransaction(user(member), trx)
      await trx.from(booted.names.users).where('id', member).delete()
    })
    assert.lengthOf(await f.membershipRows(member), 0)
    assert.isNotOk(await booted.db.from(booted.names.users).where('id', member).first())
    const [first, second] = [a, b].sort((x, y) => (String(x) < String(y) ? -1 : 1))
    assert.deepEqual(
      events.map((event) => ({
        type: event.type,
        scopeId: event.scopeId,
        actorId: 'actorId' in event ? event.actorId : undefined,
        reason: 'reason' in event ? event.reason : undefined,
      })),
      [
        { type: 'membership.removed', scopeId: first, actorId: null, reason: 'account_deleted' },
        { type: 'membership.removed', scopeId: second, actorId: null, reason: 'account_deleted' },
      ]
    )
  })

  test('export: every membership with ISO timestamps, read through trx', async ({ assert }) => {
    const scope = await f.createScope()
    const [owner, member] = await Promise.all([f.createUser(), f.createUser()])
    await f.access.memberships.createFirstMember({ scopeId: scope, userId: owner })
    await f.access.memberships.add({
      actor: { id: owner },
      scopeId: scope,
      userId: member,
      role: 'editor',
    })
    await f.access.memberships.setStatus({
      actor: { id: owner },
      scopeId: scope,
      userId: member,
      status: 'suspended',
    })
    const exported = (await f.inTrx((trx) => callbacks.exportAccountData(user(member), trx))) as {
      memberships: Array<Record<string, unknown>>
    }
    assert.lengthOf(exported.memberships, 1)
    const [row] = exported.memberships
    assert.deepInclude(row, { scopeId: scope, role: 'editor', status: 'suspended' })
    assert.deepEqual(Object.keys(row).sort(), [
      'createdAt',
      'role',
      'scopeId',
      'status',
      'updatedAt',
    ])
    for (const key of ['createdAt', 'updatedAt'] as const) {
      assert.isString(row[key])
      assert.equal(new Date(row[key] as string).toISOString(), row[key])
    }
    assert.deepEqual(await callbacks.exportAccountData(user(999999), undefined as never), {
      memberships: [],
    })
  })
})

test.group('Account Kit callbacks: admission (spec 9)', (group) => {
  let booted: TestApp
  let f: Awaited<ReturnType<typeof fixture>>
  let admitted = true
  const asked: Array<[unknown, boolean]> = []
  group.setup(async () => {
    booted = await bootTestApp({
      permissions: { ...permissions, invitations: { manage: 'editor' } } as const,
    })
    f = await fixture(booted)
    booted.app.container.bindValue('account_admission' as never, <never>{
      async isAdmitted(userId: unknown, trx?: unknown) {
        asked.push([userId, trx !== undefined])
        return admitted
      },
    })
    return () => booted.close()
  })

  test('with the admission provider bound, an unadmitted actor is denied everywhere; admission: false skips it', async ({
    assert,
  }) => {
    const scope = await f.createScope()
    const owner = await f.createUser()
    await f.access.memberships.createFirstMember({ scopeId: scope, userId: owner })
    const context = { scope: String(scope) }
    const inv = invitation({ id: 50, scope: String(scope), role: 'editor' })
    admitted = true
    assert.isTrue(await callbacks.authorize.invite(user(owner), 'editor', context))
    admitted = false
    assert.isFalse(await callbacks.authorize.invite(user(owner), 'editor', context))
    assert.isFalse(await callbacks.authorize.manageInvitation(user(owner), inv))
    assert.isFalse(await callbacks.authorize.listInvitations(user(owner), context))
    const unchecked = accessControlKitCallbacks({ admission: false })
    asked.length = 0
    assert.isTrue(await unchecked.authorize.invite(user(owner), 'editor', context))
    assert.isTrue(await unchecked.authorize.manageInvitation(user(owner), inv))
    assert.isTrue(await unchecked.authorize.listInvitations(user(owner), context))
    assert.lengthOf(asked, 0)
    await f.inTrx(async (trx) => {
      await callbacks.authorize.invite(user(owner), 'editor', { ...context, trx })
    })
    assert.deepEqual(asked, [[owner, true]])
  })

  test('a non-member is denied before admission is consulted; an editor with the key cannot invite above its rank', async ({
    assert,
  }) => {
    const scope = await f.createScope()
    const [owner, editor, outsider] = await Promise.all([
      f.createUser(),
      f.createUser(),
      f.createUser(),
    ])
    await f.access.memberships.createFirstMember({ scopeId: scope, userId: owner })
    await f.access.memberships.add({
      actor: { id: owner },
      scopeId: scope,
      userId: editor,
      role: 'editor',
    })
    admitted = true
    asked.length = 0
    assert.isFalse(
      await callbacks.authorize.invite(user(outsider), 'editor', { scope: String(scope) })
    )
    assert.lengthOf(asked, 0)
    const context = { scope: String(scope) }
    assert.isTrue(await callbacks.authorize.invite(user(editor), 'editor', context))
    assert.isTrue(await callbacks.authorize.invite(user(editor), 'viewer', context))
    assert.isFalse(await callbacks.authorize.invite(user(editor), 'admin', context))
    assert.isFalse(
      await callbacks.authorize.manageInvitation(
        user(editor),
        invitation({ id: 60, scope: String(scope), role: 'admin' })
      )
    )
    assert.isTrue(
      await callbacks.authorize.manageInvitation(
        user(editor),
        invitation({ id: 61, scope: String(scope), role: 'editor' })
      )
    )
  })
})
