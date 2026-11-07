import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { InvalidSessionError, PostCommitError } from '@kevinjohn/adonisjs-account-kit/errors'
import type { Trx } from '@kevinjohn/adonisjs-account-kit'
import { compositionFixture, type CompositionFixture } from '#tests/helpers/transaction_composition'
import {
  observeTransactions,
  type ObservedAttempt,
  type ObservedAttempts,
  type TransactionObserver,
} from '#tests/helpers/transaction_observer'

/** Tag of the case whose actor key sorts after its target key. */
const actorAfterTarget = '@actor-after-target'

/** A unique failure the application raises; it must escape unchanged. */
function sentinel(id: string, code = `E_COMPOSITION_${id}`): Error & { code: string } {
  return Object.assign(new Error(`composition ${id}`), { code })
}

/** The rejection of `promise`, or undefined when it resolves, so assertions name the failure. */
async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return undefined
}

/** A promise and its resolver, for bounded rendezvous between the test and a callback. */
function barrier(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => (release = resolve))
  return { promise, release }
}

/** Fails with `message` when `promise` does not settle within `ms`. */
async function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function busyTimeout(): Promise<unknown> {
  const [row]: Array<Record<string, unknown>> = await db.rawQuery('PRAGMA busy_timeout')
  return Object.values(row)[0]
}

/** The member's role, read through `trx` when given. */
async function role(f: CompositionFixture, userId: number, trx?: Trx): Promise<string | undefined> {
  const membership = await f.access.memberships.find(f.scopeId, userId, trx)
  return membership?.role
}

/** Session A's `last_seen_at`, read directly. */
async function lastSeen(f: CompositionFixture): Promise<unknown> {
  const session = await f.snapshotSession()
  return session.last_seen_at
}

interface MembershipRow {
  user_id: number
  role: string
  status: string
}

/** Every membership row of the fixture scope, ordered by user. */
async function scopeRows(f: CompositionFixture): Promise<MembershipRow[]> {
  return db.from('memberships').where('scope_id', f.scopeId).orderBy('user_id')
}

function count(attempts: ObservedAttempts, kind: string): number {
  return attempts.reduce(
    (total, attempt) => total + attempt.inside.filter((s) => s.kind === kind).length,
    0
  )
}

function has(attempt: ObservedAttempt, verb: string, table: string): boolean {
  return attempt.inside.some((s) => s.verb === verb && s.table === table)
}

test.group('transaction composition on SQLite', (group) => {
  group.tap((t) =>
    t.skip(
      process.env.DB_CLIENT !== 'sqlite',
      'SQLite-only composition; PostgreSQL keeps the row-lock warning'
    )
  )

  let f: CompositionFixture
  let observer: TransactionObserver
  let baseline: Record<string, unknown>

  /** A fresh fixture with session A aged, the effects cleared and the observer attached. */
  async function arrange(order: 'actor<target' | 'actor>target') {
    f = await compositionFixture({ order })
    await f.ageSession()
    await f.effects.clear()
    baseline = await f.snapshotSession()
    observer = observeTransactions(db)
  }

  async function dispose() {
    observer.detach()
    await f.cleanup()
  }

  group.each.setup(async (t) => {
    await arrange(t.options.tags.includes(actorAfterTarget) ? 'actor>target' : 'actor<target')
  })

  group.each.teardown(async () => {
    await dispose()
  })

  /** Ends the measurement window: later verification queries stay out of the evidence. */
  function settle(): ObservedAttempts {
    observer.detach()
    return observer.attempts()
  }

  /** C01: the positive path, with the actor key on either side of the target key. */
  async function changesRoleInsideWithCurrent(
    assert: import('@japa/assert').Assert,
    order: 'actor<target' | 'actor>target'
  ) {
    if (order === 'actor<target') assert.isTrue(String(f.actorId) < String(f.targetId))
    else assert.isTrue(String(f.actorId) > String(f.targetId))
    const result = await f.kit.authentication.withCurrent(f.current, async ({ account, trx }) => {
      const changed = await f.access.memberships.changeRole({
        actor: { id: account.id },
        scopeId: f.scopeId,
        userId: f.targetId,
        role: 'admin',
        trx,
      })
      assert.equal(await role(f, f.targetId, trx), 'admin')
      await f.effects.insert(trx, 'C01', 'after-role')
      return changed.role
    })
    const attempts = settle()

    assert.equal(result, 'admin')
    assert.equal(await role(f, f.targetId), 'admin')
    assert.deepEqual(await f.effects.rows(), [{ operation: 'C01', stage: 'after-role' }])
    assert.lengthOf(attempts, 1)
    assert.lengthOf(attempts.outside, 0)
    const [attempt] = attempts
    assert.equal(attempt.terminal?.kind, 'commit')
    assert.equal(count(attempts, 'rollback'), 0)
    assert.equal(count(attempts, 'savepoint'), 0)
    assert.equal(count(attempts, 'release'), 0)
    const statements = [attempt.begin, ...attempt.inside, attempt.terminal!]
    assert.lengthOf(new Set(statements.map((s) => s.connectionId)), 1)
    assert.lengthOf(new Set(statements.map((s) => s.transactionId)), 1)
    assert.equal(attempt.inside[0].table, 'account_transaction_lock')
    assert.isTrue(attempt.inside.every((s) => s.outcome === 'succeeded'))
    assert.isTrue(has(attempt, 'update', 'account_sessions'))
    assert.isTrue(has(attempt, 'update', 'memberships'))
    assert.isTrue(has(attempt, 'insert', 'composition_effects'))
    assert.notEqual(await lastSeen(f), baseline.last_seen_at)
  }

  test("changes another member's role inside withCurrent with the supplied trx (actor < target)", async ({
    assert,
  }) => {
    await changesRoleInsideWithCurrent(assert, 'actor<target')
  })

  test("changes another member's role inside withCurrent with the supplied trx (actor > target)", async ({
    assert,
  }) => {
    await changesRoleInsideWithCurrent(assert, 'actor>target')
  }).tags([actorAfterTarget])

  test('rolls back the package write and the session touch when the application throws', async ({
    assert,
  }) => {
    const thrown = sentinel('C02')
    let calls = 0
    const error = await failure(
      f.kit.authentication.withCurrent(f.current, async ({ account, trx }) => {
        calls++
        await f.access.memberships.changeRole({
          actor: { id: account.id },
          scopeId: f.scopeId,
          userId: f.targetId,
          role: 'admin',
          trx,
        })
        assert.equal(await role(f, f.targetId, trx), 'admin')
        await f.effects.insert(trx, 'C02', 'after-role')
        throw thrown
      })
    )
    const attempts = settle()

    // C09: the application's failure escapes unchanged, after one run.
    assert.strictEqual(error, thrown)
    assert.equal(calls, 1)
    assert.equal(await role(f, f.targetId), 'editor')
    assert.deepEqual(await f.effects.rows(), [])
    assert.deepEqual(await f.snapshotSession(), baseline)
    assert.lengthOf(attempts, 1)
    assert.lengthOf(attempts.outside, 0)
    assert.equal(attempts[0].terminal?.kind, 'rollback')
    assert.isTrue(has(attempts[0], 'update', 'account_sessions'))
    assert.isTrue(has(attempts[0], 'update', 'memberships'))
    assert.isTrue(has(attempts[0], 'insert', 'composition_effects'))
  })

  test('rolls back the hook write when the package hook throws', async ({ assert }) => {
    const thrown = sentinel('C03')
    const seen: boolean[] = []
    const roles: string[] = []
    let callbackTrx: Trx | undefined
    const access = f.hookAccess(async (_event, hookTrx) => {
      seen.push(hookTrx === callbackTrx)
      const membership = await f.access.memberships.find(f.scopeId, f.targetId, hookTrx)
      roles.push(membership!.role)
      await f.effects.insert(hookTrx, 'C03', 'hook')
      throw thrown
    })
    const error = await failure(
      f.kit.authentication.withCurrent(f.current, async ({ account, trx }) => {
        callbackTrx = trx
        await access.memberships.changeRole({
          actor: { id: account.id },
          scopeId: f.scopeId,
          userId: f.targetId,
          role: 'admin',
          trx,
        })
      })
    )
    const attempts = settle()

    assert.strictEqual(error, thrown)
    assert.deepEqual(seen, [true])
    assert.deepEqual(roles, ['admin'])
    assert.equal(await role(f, f.targetId), 'editor')
    assert.deepEqual(await f.effects.rows(), [])
    assert.deepEqual(await f.snapshotSession(), baseline)
    assert.lengthOf(attempts, 1)
    assert.lengthOf(attempts.outside, 0)
    assert.equal(attempts[0].terminal?.kind, 'rollback')
    assert.isTrue(has(attempts[0], 'insert', 'composition_effects'))
  })

  test('refuses a package call that omits trx inside withCurrent with the Kit nesting error', async ({
    assert,
  }) => {
    const error = await within(
      failure(
        f.kit.authentication.withCurrent(f.current, async ({ account }) => {
          await f.access.memberships.changeRole({
            actor: { id: account.id },
            scopeId: f.scopeId,
            userId: f.targetId,
            role: 'admin',
          })
        })
      ),
      2000,
      'C04: pool acquisition instead of nesting refusal'
    )
    const attempts = settle()

    assert.equal(
      (error as Error | undefined)?.message,
      'Account kit transactions cannot be nested; use the trx you were given'
    )
    assert.equal(await role(f, f.targetId), 'editor')
    assert.deepEqual(await f.effects.rows(), [])
    assert.lengthOf(attempts, 1)
    assert.lengthOf(attempts.outside, 0)
    assert.lengthOf(
      observer.statements().filter((s) => s.kind === 'begin'),
      1
    )
  })

  test('fails before the callback when the shared lock row is missing', async ({ assert }) => {
    let entered = false
    let error: unknown
    let attempts: ObservedAttempts
    await db.from('account_transaction_lock').delete()
    try {
      error = await failure(
        f.kit.authentication.withCurrent(f.current, async () => {
          entered = true
        })
      )
      attempts = settle()
    } finally {
      const lock = await db.from('account_transaction_lock').where('id', 1).first()
      if (!lock) await db.table('account_transaction_lock').insert({ id: 1, version: 0 })
      assert.equal(await busyTimeout(), 1000)
    }

    assert.isFalse(entered)
    assert.equal(
      (error as Error | undefined)?.message,
      'Account kit SQLite transaction lock row is missing; restore singleton id=1'
    )
    assert.equal(await role(f, f.targetId), 'editor')
    assert.lengthOf(attempts, 1)
    assert.equal(attempts[0].terminal?.kind, 'rollback')
    // Dispatched without a control-query error.
    assert.equal(attempts[0].terminal?.outcome, 'dispatched')
    assert.isFalse(attempts.some((a) => a.terminal?.kind === 'commit'))
  })

  test('refuses the operation when session B revokes session A first', async ({ assert }) => {
    const poised = barrier()
    let entered = false
    const pending = (async () => {
      await poised.promise
      return f.kit.authentication.withCurrent(f.current, async ({ account, trx }) => {
        entered = true
        await f.access.memberships.changeRole({
          actor: { id: account.id },
          scopeId: f.scopeId,
          userId: f.targetId,
          role: 'admin',
          trx,
        })
      })
    })()
    try {
      await f.kit.authentication.sessions.revoke({ current: f.revoker, id: f.signInId })
      assert.isNull(await db.from('account_sessions').where('id', f.signInId).first())
    } finally {
      poised.release()
    }
    const error = await within(failure(pending), 2000, 'C06: pending operation did not settle')
    settle()

    assert.instanceOf(error, InvalidSessionError)
    assert.isFalse(entered)
    assert.equal(await role(f, f.targetId), 'editor')
    assert.deepEqual(await f.effects.rows(), [])
    assert.isArray(await f.kit.authentication.sessions.list({ current: f.revoker }))
  })

  test('commits the membership change before a competing revocation that waits for the connection', async ({
    assert,
  }) => {
    const inside = barrier()
    const releaseWrite = barrier()
    const pending = f.kit.authentication.withCurrent(f.current, async ({ account, trx }) => {
      await f.access.memberships.changeRole({
        actor: { id: account.id },
        scopeId: f.scopeId,
        userId: f.targetId,
        role: 'admin',
        trx,
      })
      await f.effects.insert(trx, 'C07', 'after-role')
      inside.release()
      await releaseWrite.promise
    })
    let revoke: Promise<unknown> | undefined
    try {
      await within(inside.promise, 2000, 'C07: the operation never reached its write')
      const pool = db.connection().getWriteClient().client.pool
      // Tarn 3.1.2 has on/removeListener and no once; arm before starting the revocation.
      const requested = new Promise<void>((resolve) => {
        const listener = () => {
          pool.removeListener('acquireRequest', listener)
          resolve()
        }
        pool.on('acquireRequest', listener)
      })
      revoke = f.kit.authentication.sessions.revoke({ current: f.revoker, id: f.signInId })
      await within(requested, 2000, 'C07: the revocation never asked for the connection')
      assert.equal(pool.numUsed(), 1)
      assert.equal(pool.numPendingAcquires(), 1)
      assert.isFalse(
        observer.statements().some((s) => s.verb === 'delete' && s.table === 'account_sessions')
      )
    } finally {
      releaseWrite.release()
      await Promise.allSettled([pending, revoke])
    }
    await Promise.all([pending, revoke])
    const attempts = settle()

    const commit = attempts[0].terminal!
    const deletion = observer
      .statements()
      .find((s) => s.verb === 'delete' && s.table === 'account_sessions')
    assert.equal(commit.kind, 'commit')
    assert.isTrue(has(attempts[0], 'update', 'memberships'))
    assert.isDefined(deletion)
    assert.isBelow(commit.seq, deletion!.seq)
    // B ran in its own later transaction, which deleted session A and committed.
    assert.lengthOf(attempts, 2)
    assert.lengthOf(attempts.outside, 0)
    assert.include(attempts[1].inside, deletion!)
    assert.equal(attempts[1].terminal?.kind, 'commit')
    assert.equal(await role(f, f.targetId), 'admin')
    assert.deepEqual(await f.effects.rows(), [{ operation: 'C07', stage: 'after-role' }])
    assert.instanceOf(
      await failure(f.kit.authentication.withCurrent(f.current, async () => {})),
      InvalidSessionError
    )
    assert.isArray(await f.kit.authentication.sessions.list({ current: f.revoker }))
  })

  test('retries once after a transient {code} thrown after the writes')
    .with([{ code: 'SQLITE_BUSY' }, { code: 'SQLITE_BUSY_SNAPSHOT' }])
    .run(async ({ assert }, { code }) => {
      let attempt = 0
      const result = await f.kit.authentication.withCurrent(f.current, async ({ account, trx }) => {
        attempt++
        await f.access.memberships.changeRole({
          actor: { id: account.id },
          scopeId: f.scopeId,
          userId: f.targetId,
          role: 'admin',
          trx,
        })
        await f.effects.insert(trx, 'C08', `attempt-${attempt}`)
        if (attempt === 1) throw sentinel('C08', code)
        return 'done'
      })
      const attempts = settle()

      assert.equal(result, 'done')
      assert.equal(attempt, 2)
      assert.equal(await role(f, f.targetId), 'admin')
      assert.deepEqual(await f.effects.rows(), [{ operation: 'C08', stage: 'attempt-2' }])
      assert.deepEqual(
        attempts.map((a) => a.terminal?.kind),
        ['rollback', 'commit']
      )
      assert.lengthOf(attempts.outside, 0)
      assert.isTrue(attempts.every((a) => has(a, 'update', 'account_sessions')))
      assert.notEqual(await lastSeen(f), baseline.last_seen_at)
    })

  test('reports a post-commit failure as PostCommitError without a second attempt', async ({
    assert,
  }) => {
    const thrown = sentinel('C10', 'SQLITE_BUSY')
    let calls = 0
    const error = await failure(
      f.kit.authentication.withCurrent(f.current, async ({ account, trx }) => {
        calls++
        trx.on('commit', () => {
          throw thrown
        })
        await f.access.memberships.changeRole({
          actor: { id: account.id },
          scopeId: f.scopeId,
          userId: f.targetId,
          role: 'admin',
          trx,
        })
        await f.effects.insert(trx, 'C10', 'after-role')
      })
    )
    const attempts = settle()

    assert.instanceOf(error, PostCommitError)
    assert.strictEqual((error as PostCommitError).cause, thrown)
    assert.isTrue((error as PostCommitError).committed)
    assert.equal(calls, 1)
    assert.equal(await role(f, f.targetId), 'admin')
    assert.deepEqual(await f.effects.rows(), [{ operation: 'C10', stage: 'after-role' }])
    assert.lengthOf(attempts, 1)
    assert.lengthOf(attempts.outside, 0)
    assert.equal(attempts[0].terminal?.kind, 'commit')
  })

  test('forwards trx for add, setStatus, remove and transferOwnership', async ({ assert }) => {
    const owners = (rows: MembershipRow[]) => rows.filter((r) => r.role === 'owner')
    const operations: Array<{
      operation: string
      session: 'current' | 'owner'
      run: (actorId: number, trx: Trx) => Promise<unknown>
      /** The operation's write, read back through `trx` before the fault. */
      wrote: (rows: MembershipRow[]) => boolean
    }> = [
      {
        operation: 'add',
        session: 'current',
        run: (actorId, trx) =>
          f.access.memberships.add({
            actor: { id: actorId },
            scopeId: f.scopeId,
            userId: f.outsiderId,
            role: 'viewer',
            trx,
          }),
        wrote: (rows) => rows.some((r) => r.user_id === f.outsiderId && r.role === 'viewer'),
      },
      {
        operation: 'setStatus',
        session: 'current',
        run: (actorId, trx) =>
          f.access.memberships.setStatus({
            actor: { id: actorId },
            scopeId: f.scopeId,
            userId: f.targetId,
            status: 'suspended',
            trx,
          }),
        wrote: (rows) => rows.some((r) => r.user_id === f.targetId && r.status === 'suspended'),
      },
      {
        operation: 'remove',
        session: 'current',
        run: (actorId, trx) =>
          f.access.memberships.remove({
            actor: { id: actorId },
            scopeId: f.scopeId,
            userId: f.targetId,
            trx,
          }),
        wrote: (rows) => !rows.some((r) => r.user_id === f.targetId),
      },
      {
        operation: 'transferOwnership',
        session: 'owner',
        run: (actorId, trx) =>
          f.access.memberships.transferOwnership({
            actor: { id: actorId },
            scopeId: f.scopeId,
            toUserId: f.actorId,
            trx,
          }),
        wrote: (rows) => owners(rows).length === 1 && owners(rows)[0].user_id === f.actorId,
      },
    ]
    for (const [index, row] of operations.entries()) {
      // Each operation gets fresh fixture rows; the group hooks own the first and the last.
      if (index > 0) {
        await dispose()
        await arrange('actor<target')
      }
      const thrown = sentinel('C11')
      const before = { memberships: await scopeRows(f), effects: await f.effects.rows() }
      assert.lengthOf(owners(before.memberships), 1, row.operation)
      // The snapshot reads stay out of the measured window.
      observer.detach()
      observer = observeTransactions(db)
      let changed: MembershipRow[] | undefined
      const error = await failure(
        f.kit.authentication.withCurrent(f[row.session], async ({ account, trx }) => {
          await row.run(account.id as number, trx)
          changed = await trx.from('memberships').where('scope_id', f.scopeId).orderBy('user_id')
          await f.effects.insert(trx, 'C11', row.operation)
          throw thrown
        })
      )
      const attempts = settle()

      // The package call returned and its write is visible through trx before the fault.
      assert.isDefined(changed, row.operation)
      assert.isTrue(row.wrote(changed!), row.operation)
      assert.deepEqual(
        { memberships: await scopeRows(f), effects: await f.effects.rows() },
        before,
        row.operation
      )
      assert.strictEqual(error, thrown, row.operation)
      assert.deepEqual(await f.snapshotSession(), baseline, row.operation)
      assert.lengthOf(owners(await scopeRows(f)), 1, row.operation)
      assert.lengthOf(attempts, 1, row.operation)
      assert.lengthOf(attempts.outside, 0, row.operation)
      assert.equal(attempts[0].terminal?.kind, 'rollback', row.operation)
    }
  })
})
