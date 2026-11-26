import { test } from '@japa/runner'
import { AccountKit, defineConfig } from '@kevinjohn/adonisjs-account-kit'
import type { AccountUser, UsersAdapter } from '@kevinjohn/adonisjs-account-kit'
import { DateTime } from 'luxon'
import { accessControlKitCallbacks } from '../account_kit/main.ts'
import { loadRunner } from '../src/kit_transaction.ts'
import { bootTestApp } from './helpers/app.ts'
import { testEngine } from './helpers/database.ts'
import { codeOf } from './helpers/fixture.ts'

function tokenOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.split('/').at(-1)!)
}

test('Kit accepts canonical batches in stored scope order and rolls back a late alias', async ({
  assert,
}) => {
  const transactionalEvents: string[] = []
  const booted = await bootTestApp({
    keyTypes: { users: 'integer', scope: 'string' },
    caseInsensitiveKeys: true,
    async onMembershipChanged(change, trx) {
      if (change.type === 'membership.invitation_accepted') {
        await trx.table('invitation_event_probe').insert({ scope_id: String(change.scopeId) })
        transactionalEvents.push(String(change.scopeId))
      }
    },
  })
  try {
    const db = booted.db
    await db.connection().schema.createTable('invitation_event_probe', (table) => {
      table.increments('id')
      table.string('scope_id').notNullable()
    })
    await db.connection().schema.alterTable(booted.names.users, (table) => {
      table.string('email', 254).nullable().unique()
      table.string('password').nullable()
      table.timestamp('email_verified_at').nullable()
    })
    await db.connection().schema.createTable('account_invitations', (table) => {
      table.increments('id')
      table.string('email', 254).notNullable()
      table.string('scope', 254).notNullable()
      table.string('role', 64).notNullable()
      table.integer('inviter_id').nullable()
      table.string('token_hash', 64).notNullable().unique()
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('updated_at', { useTz: true, precision: 3 }).notNullable()
      table.unique(['email', 'scope'])
    })
    const access = await booted.app.container.make('access_control.manager')
    const runner = await loadRunner()
    const locks: string[] = []
    access.attach(db, {
      ...runner,
      async lockRow(trx, table, id) {
        if (table === booted.names.scope) locks.push(String(id))
        return runner.lockRow(trx, table, id)
      },
    })
    for (const scope of ['B', 'a'])
      await db.table(booted.names.scope).insert({ id: scope, name: scope })
    const [owner] = await db
      .table(booted.names.users)
      .returning('id')
      .insert({ name: 'owner', email: 'owner@example.test' })
    const ownerId = Number(typeof owner === 'object' ? owner.id : owner)
    for (const scope of ['B', 'a'])
      await access.memberships.createFirstMember({ scopeId: scope, userId: ownerId })
    locks.length = 0
    transactionalEvents.length = 0
    const toUser = (row: {
      id: number
      email: string
      password: string | null
      email_verified_at: unknown
    }): AccountUser => ({
      id: row.id,
      email: row.email,
      unverifiedEmail: null,
      hasPassword: row.password !== null,
      emailVerifiedAt: row.email_verified_at
        ? DateTime.fromJSDate(new Date(String(row.email_verified_at)))
        : null,
    })
    const users: UsersAdapter = {
      async findByEmail(email, trx) {
        const row = await (trx ?? db).from(booted.names.users).where('email', email).first()
        return row ? toUser(row) : null
      },
      async findById(id, trx) {
        const row = await (trx ?? db).from(booted.names.users).where('id', id).first()
        return row ? toUser(row) : null
      },
      async create(attrs, trx) {
        const [inserted] = await trx
          .table(booted.names.users)
          .returning('id')
          .insert({
            name: attrs.email,
            email: attrs.email,
            password: attrs.passwordHash ?? attrs.password,
          })
        const id = Number(typeof inserted === 'object' ? inserted.id : inserted)
        return (await users.findById(id, trx))!
      },
      async markEmailVerified(id, at, trx) {
        await trx
          .from(booted.names.users)
          .where('id', id)
          .update({ email_verified_at: at.toJSDate() })
      },
      async setPassword(id, password, trx) {
        await trx.from(booted.names.users).where('id', id).update({ password })
      },
      async setEmail(id, email, trx) {
        await trx.from(booted.names.users).where('id', id).update({ email })
      },
      async setUnverifiedEmail() {},
      async verifyPassword() {
        return false
      },
    }
    const callbacks = accessControlKitCallbacks()
    const sequence: string[] = []
    const kit = new AccountKit({
      config: defineConfig({
        users,
        usersTable: booted.names.users,
        enabled: ['invitations'],
        limiterSecret: 'test-secret-that-is-at-least-thirty-two-bytes',
        registration: { availability: 'closed' },
        authorize: callbacks.authorize,
        urls: { invitation: (token) => `https://example.test/invite/${token}` },
        notify: { invitationProvision: async () => {} },
        async onInvitationAccepted(user, invitation, trx) {
          sequence.push(invitation.scope!)
          await callbacks.onInvitationAccepted(user, invitation, trx)
        },
      }),
      db,
      limiter: {} as never,
    })
    async function invite(email: string, scope: string) {
      const result = await kit.operator.invite({ email, scope, role: 'editor', deliver: 'print' })
      assert.isUndefined(result.fault)
      return tokenOf(result.url!)
    }
    const exactEmail = 'batch-exact@example.test'
    const exactA = await invite(exactEmail, 'a')
    await invite(exactEmail, 'B')
    const accepted = await kit.invitations.accept({ token: exactA, password: 'strong-password' })
    assert.deepEqual(sequence, ['B', 'a'])
    assert.deepEqual(locks, ['B', 'a'])
    const acceptedMemberships = await access.memberships.listForUser(accepted.id)
    assert.deepEqual(
      acceptedMemberships.map((m) => m.scopeId),
      ['B', 'a']
    )
    assert.lengthOf(await db.from('account_invitations').where('email', exactEmail), 0)
    if (testEngine === 'pg') return

    sequence.length = 0
    locks.length = 0
    transactionalEvents.length = 0
    const aliasEmail = 'batch-alias@example.test'
    const aliasFirst = await invite(aliasEmail, 'a')
    await invite(aliasEmail, 'b')
    assert.equal(
      await codeOf(kit.invitations.accept({ token: aliasFirst, password: 'strong-password' })),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    assert.deepEqual(sequence, ['a', 'b'])
    assert.deepEqual(locks, ['a'])
    assert.lengthOf(await db.from('account_invitations').where('email', aliasEmail), 2)
    assert.isNull(await users.findByEmail(aliasEmail))
    assert.lengthOf(await db.from('invitation_event_probe').where('scope_id', 'a'), 1)
    assert.deepEqual(transactionalEvents, ['a'])

    sequence.length = 0
    locks.length = 0
    const earlyEmail = 'batch-early@example.test'
    const early = await invite(earlyEmail, 'A')
    await invite(earlyEmail, 'B')
    assert.equal(
      await codeOf(kit.invitations.accept({ token: early, password: 'strong-password' })),
      'E_ACCESS_CONTROL_INVALID_INPUT'
    )
    assert.deepEqual(sequence, ['A'])
    assert.deepEqual(locks, [])
    assert.lengthOf(await db.from('account_invitations').where('email', earlyEmail), 2)
    assert.isNull(await users.findByEmail(earlyEmail))
  } finally {
    await booted.db.connection().schema.dropTableIfExists('account_invitations')
    await booted.db.connection().schema.dropTableIfExists('invitation_event_probe')
    await booted.close()
  }
})
