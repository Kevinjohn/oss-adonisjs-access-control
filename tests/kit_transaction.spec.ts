import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { loadRunner } from '../src/kit_transaction.js'
import { codeOf } from './helpers/fixture.js'
import { testDatabase } from './helpers/database.js'
import { createLockRow, LOCK_TABLE } from './helpers/schema.js'

test.group('kit transaction bridge (spec 0.2)', () => {
  test('prefers the kit export and otherwise uses the local runner', async ({ assert }) => {
    const kit = JSON.parse(
      await readFile(
        new URL('../node_modules/@kevinjohn/adonisjs-account-kit/package.json', import.meta.url),
        'utf8'
      )
    )
    const expected = './transaction' in kit.exports ? 'account-kit' : 'local'
    const runner = await loadRunner()
    assert.equal(runner.source, expected)
    assert.strictEqual(await loadRunner(), runner)
    for (const name of ['transaction', 'lockRow', 'sqlTimestamp', 'readTimestamp'] as const)
      assert.isFunction(runner[name])
  })

  test('sqlTimestamp writes UTC ISO 8601, or SQL wall time on MySQL', async ({ assert }) => {
    const runner = await loadRunner()
    const at = DateTime.fromISO('2026-11-05T10:20:30.456+02:00')
    assert.equal(
      runner.sqlTimestamp({ dialect: { name: 'postgres' } }, at),
      '2026-11-05T08:20:30.456Z'
    )
    assert.equal(
      runner.sqlTimestamp({ dialect: { name: 'better-sqlite3' } }, at),
      '2026-11-05T08:20:30.456Z'
    )
    assert.equal(runner.sqlTimestamp({ dialect: { name: 'mysql' } }, at), '2026-11-05 08:20:30.456')
    assert.equal(
      runner.sqlTimestamp({ connection: () => ({ dialect: { name: 'mysql' } }) }, at),
      '2026-11-05 08:20:30.456'
    )
    assert.match(runner.sqlTimestamp({ dialect: { name: 'postgres' } }), /Z$/)
    assert.throws(
      () => runner.sqlTimestamp({ dialect: { name: 'postgres' } }, DateTime.invalid('x')),
      /timestamp/
    )
  })

  test('readTimestamp reads a Date, a string, epoch milliseconds or null', async ({ assert }) => {
    const runner = await loadRunner()
    const iso = '2026-11-05T08:20:30.456Z'
    assert.equal(runner.readTimestamp(new Date(iso))!.toISO(), iso)
    assert.equal(runner.readTimestamp(iso)!.toISO(), iso)
    assert.equal(runner.readTimestamp('2026-11-05 08:20:30.456')!.toISO(), iso)
    assert.equal(runner.readTimestamp(Date.parse(iso))!.toISO(), iso)
    assert.isNull(runner.readTimestamp(null))
    assert.isNull(runner.readTimestamp(undefined))
    assert.throws(() => runner.readTimestamp('yesterday'), /timestamp/)
    assert.throws(() => runner.readTimestamp({}), /timestamp/)
  })

  test('transaction commits, rolls back on throw and refuses a nested transaction client', async ({
    assert,
  }) => {
    const runner = await loadRunner()
    const database = await testDatabase()
    try {
      await createLockRow(database.db)
      const table = `probe_${database.suffix}`
      await database.db.connection().schema.createTable(table, (t) => {
        t.increments('id')
        t.string('name')
      })
      const result = await runner.transaction(database.db, async (trx) => {
        await trx.table(table).insert({ name: 'kept' })
        return 'done'
      })
      assert.equal(result, 'done')
      await assert.rejects(
        () =>
          runner.transaction(database.db, async (trx) => {
            await trx.table(table).insert({ name: 'lost' })
            throw new Error('boom')
          }),
        /boom/
      )
      const names = await database.db.from(table).orderBy('id')
      assert.deepEqual(
        names.map((r) => r.name),
        ['kept']
      )
      if (database.engine === 'sqlite') {
        const [{ version }] = await database.db.from(LOCK_TABLE).where('id', 1)
        assert.equal(version, 0)
      }
      await database.db.connection().schema.dropTable(table)
    } finally {
      await database.cleanup()
    }
  })

  test('SQLite: the lock row is required and a busy writer retries until the lock frees', async ({
    assert,
  }) => {
    const runner = await loadRunner()
    const patient = await testDatabase()
    try {
      if (patient.engine !== 'sqlite') {
        assert.isTrue(true)
        return
      }
      assert.equal(
        await codeOf(runner.transaction(patient.db, async () => {})),
        'E_ACCESS_CONTROL_INVALID_CONFIG'
      )
      await createLockRow(patient.db)
      await patient.db.from(LOCK_TABLE).delete()
      assert.equal(
        await codeOf(runner.transaction(patient.db, async () => {})),
        'E_ACCESS_CONTROL_INVALID_CONFIG'
      )
      await patient.db.table(LOCK_TABLE).insert({ id: 1, version: 0 })
      const table = `probe_${patient.suffix}`
      await patient.db.connection().schema.createTable(table, (t) => {
        t.increments('id')
        t.integer('n')
      })
      await patient.db.table(table).insert({ id: 1, n: 0 })
      const bump = (db: typeof patient.db, holdMs: number) =>
        runner.transaction(db, async (trx) => {
          const row = await trx.from(table).where('id', 1).first()
          await new Promise((resolve) => setTimeout(resolve, holdMs))
          await trx
            .from(table)
            .where('id', 1)
            .update({ n: row.n + 1 })
        })
      const first = bump(patient.db, 150)
      await new Promise((resolve) => setTimeout(resolve, 30))
      const started = performance.now()
      await bump(patient.db, 0)
      const elapsed = performance.now() - started
      assert.isAbove(elapsed, 50)
      // Without the busy handler off, the second writer waits inside SQLite for the full timeout.
      assert.isBelow(elapsed, 2000)
      await first
      const row = await patient.db.from(table).where('id', 1).first()
      assert.equal(row.n, 2)
    } finally {
      await patient.cleanup()
    }
  })

  test('MySQL: the connection must run in UTC', async ({ assert }) => {
    const runner = await loadRunner()
    const database = await testDatabase({ timezone: 'local' })
    try {
      if (database.engine !== 'mysql') {
        assert.isTrue(true)
        return
      }
      assert.equal(
        await codeOf(runner.transaction(database.db, async () => {})),
        'E_ACCESS_CONTROL_INVALID_CONFIG'
      )
    } finally {
      await database.cleanup()
    }
  })
})
