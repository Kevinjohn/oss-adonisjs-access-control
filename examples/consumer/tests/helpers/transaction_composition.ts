import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import { AccountKit, defineConfig } from '@kevinjohn/adonisjs-account-kit'
import type {
  AuthenticationGuard,
  CurrentAccountInput,
  Trx,
  UserId,
} from '@kevinjohn/adonisjs-account-kit'
import {
  lockRow,
  readTimestamp,
  sqlTimestamp,
  transaction,
} from '@kevinjohn/adonisjs-account-kit/transaction'
import { defineAccessControl, type AccessControl } from '@kevinjohn/adonisjs-access-control'
import accessControl from '@kevinjohn/adonisjs-access-control/services/main'
import { createAccountKitConfig } from '#config/account_kit'
import User from '#models/user'

/** Additional application writes, standing in for audit rows and receipts. */
export interface CompositionEffects {
  insert(trx: Trx, operation: string, stage: string): Promise<void>
  rows(): Promise<Array<{ operation: string; stage: string }>>
  clear(): Promise<void>
}

/**
 * A real Kit with session management, real sign-ins and an isolated team, for running membership
 * operations inside `authentication.withCurrent`.
 */
export interface CompositionFixture {
  kit: AccountKit
  /** The booted provider instance. */
  access: AccessControl
  /** Session A of the acting identity. */
  current: CurrentAccountInput
  /** Session B of the same identity. */
  revoker: CurrentAccountInput
  /** A session of the owner, for operations only the owner may run. */
  owner: CurrentAccountInput
  /** Registry id of session A. */
  signInId: number
  scopeId: number
  /** The admin. */
  actorId: number
  /** The editor. */
  targetId: number
  /** Bruce Wayne, the owner. */
  ownerId: number
  /** A confirmed user without a membership. */
  outsiderId: number
  effects: CompositionEffects
  /** The `account_sessions` row of session A. */
  snapshotSession(): Promise<Record<string, unknown>>
  /** Sets session A's `last_seen_at` six minutes back, so the next accepted use touches it. */
  ageSession(): Promise<void>
  /** A separate instance on the same database with `onMembershipChanged` set. */
  hookAccess(onMembershipChanged: AccessControl['config']['onMembershipChanged']): AccessControl
  cleanup(): Promise<void>
}

export interface CompositionOptions {
  /** Code-unit order of the actor key against the target key. Default `actor<target`. */
  order?: 'actor<target' | 'actor>target'
}

const password = 'secret-password'
const effectsTable = 'composition_effects'

/** A session guard that keeps what the Kit establishes in memory. */
function captureGuard() {
  let established: { userId: UserId; revision: string | null; handle?: string } | undefined
  const guard: AuthenticationGuard<void> = {
    strategy: 'session',
    name: 'web',
    async establish(userId, revision, handle) {
      established = { userId, revision, handle }
    },
    async terminate() {
      established = undefined
    },
  }
  return { guard, established: () => established }
}

/** What a fixture has created so far. */
interface CreatedRows {
  table: boolean
  scopeId?: number
  userIds: number[]
}

/** Removes created rows, children first, then drops the effects table. */
async function discard(created: CreatedRows): Promise<void> {
  const { scopeId } = created
  if (scopeId !== undefined)
    await transaction(db, (trx) => accessControl.memberships.removeAllForScope({ scopeId, trx }))
  if (created.table) await db.from(effectsTable).delete()
  if (created.userIds.length > 0) {
    await db.from('account_sessions').whereIn('user_id', created.userIds).delete()
    await db.from('users').whereIn('id', created.userIds).delete()
  }
  if (scopeId !== undefined) await db.from('teams').where('id', scopeId).delete()
  if (created.table) await db.connection().schema.dropTable(effectsTable)
}

async function readBusyTimeout(): Promise<unknown> {
  const [row]: Array<Record<string, unknown>> = await db.rawQuery('PRAGMA busy_timeout')
  return Object.values(row)[0]
}

export async function compositionFixture(
  options: CompositionOptions = {}
): Promise<CompositionFixture> {
  const lockRows = await db.from('account_transaction_lock').select('id')
  if (lockRows.length !== 1 || Number(lockRows[0].id) !== 1)
    throw new Error('composition fixture: expected one lock row with id 1')

  const raw = createAccountKitConfig()
  if (raw.enabled!.includes('sessionManagement'))
    throw new Error('composition fixture: the consumer config already enables sessionManagement')
  const kit = new AccountKit({
    config: defineConfig({
      ...raw,
      enabled: [...raw.enabled!, 'sessionManagement'],
      sessionManagement: { idleExpiry: '14d' },
    }),
    db,
    limiter,
  })
  const created: CreatedRows = { table: false, userIds: [] }
  try {
    return await build(options, kit, created)
  } catch (error) {
    // A half-built fixture would make the next one fail on its unique emails or the table.
    await discard(created)
    throw error
  }
}

async function build(
  options: CompositionOptions,
  kit: AccountKit,
  created: CreatedRows
): Promise<CompositionFixture> {
  const access = accessControl
  await db.connection().schema.createTable(effectsTable, (t) => {
    t.increments('id')
    t.string('operation').notNullable()
    t.string('stage').notNullable()
  })
  created.table = true

  const [team] = await db
    .table('teams')
    .returning('id')
    .insert({ name: 'Justice League', created_at: new Date() })
  const scopeId = Number(typeof team === 'object' ? team.id : team)
  created.scopeId = scopeId
  const confirmed = async (email: string, fullName: string) => {
    const user = await User.create({ email, password, fullName, emailVerifiedAt: DateTime.utc() })
    created.userIds.push(user.id)
    return user
  }
  const bruce = await confirmed('bruce.wayne@wayne.example', 'Bruce Wayne')
  // Create the pair in the requested order, then assign roles from the actual key strings.
  const order = options.order ?? 'actor<target'
  const pair =
    order === 'actor<target'
      ? [
          await confirmed('diana.prince@themyscira.example', 'Diana Prince'),
          await confirmed('clark.kent@dailyplanet.example', 'Clark Kent'),
        ]
      : [
          await confirmed('clark.kent@dailyplanet.example', 'Clark Kent'),
          await confirmed('diana.prince@themyscira.example', 'Diana Prince'),
        ]
  pair.sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
  const [actor, target] = order === 'actor<target' ? pair : [pair[1], pair[0]]
  const outsider = await confirmed('barry.allen@centralcity.example', 'Barry Allen')

  await access.memberships.createFirstMember({ scopeId, userId: bruce.id })
  await access.memberships.add({
    actor: { id: bruce.id },
    scopeId,
    userId: actor.id,
    role: 'admin',
  })
  await access.memberships.add({
    actor: { id: bruce.id },
    scopeId,
    userId: target.id,
    role: 'editor',
  })

  async function signIn(email: string): Promise<CurrentAccountInput> {
    const { guard, established } = captureGuard()
    await kit.authentication.login({ email, password, clientKey: 'composition-test' }, guard)
    const session = established()
    if (!session || typeof session.handle !== 'string' || session.handle.length === 0)
      throw new Error('composition fixture: login established no session handle')
    return { userId: session.userId, revision: session.revision, sessionHandle: session.handle }
  }
  const current = await signIn(actor.email)
  const revoker = await signIn(actor.email)
  const owner = await signIn(bruce.email)
  const signIns = await kit.authentication.sessions.list({ current })
  const signInId = signIns.find((s) => s.current)?.id
  if (signInId === undefined) throw new Error('composition fixture: session A is not listed')

  const effects: CompositionEffects = {
    async insert(trx, operation, stage) {
      await trx.table(effectsTable).insert({ operation, stage })
    },
    async rows() {
      return db.from(effectsTable).select('operation', 'stage').orderBy('id')
    },
    async clear() {
      await db.from(effectsTable).delete()
    },
  }

  return {
    kit,
    access,
    current,
    revoker,
    owner,
    signInId,
    scopeId,
    actorId: actor.id,
    targetId: target.id,
    ownerId: bruce.id,
    outsiderId: outsider.id,
    effects,
    async snapshotSession() {
      const row = await db.from('account_sessions').where('id', signInId).first()
      if (!row) throw new Error('composition fixture: session A has no registry row')
      return { ...row }
    },
    async ageSession() {
      const client = db.connection()
      await db
        .from('account_sessions')
        .where('id', signInId)
        .update({
          last_seen_at: sqlTimestamp(client, DateTime.utc().minus({ minutes: 6 })),
          expires_at: sqlTimestamp(client, DateTime.utc().plus({ days: 1 })),
        })
    },
    hookAccess(onMembershipChanged) {
      return defineAccessControl({ ...access.config, onMembershipChanged }).attach(db, {
        source: 'account-kit',
        transaction,
        lockRow,
        sqlTimestamp,
        readTimestamp,
      })
    },
    async cleanup() {
      await discard(created)
      const busyTimeout = await readBusyTimeout()
      if (busyTimeout !== 1000)
        throw new Error(`composition fixture: busy_timeout is ${busyTimeout}, expected 1000`)
    },
  }
}
