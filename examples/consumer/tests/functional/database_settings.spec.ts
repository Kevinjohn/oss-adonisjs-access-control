import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import dbConfig from '#config/database'

test('the SQLite connection runs with the product durability settings', async ({ assert }) => {
  /** Reads one pragma through the pool's only connection. */
  async function pragma(name: string): Promise<unknown> {
    const rows: Array<Record<string, unknown>> = await db.rawQuery(`PRAGMA ${name}`)
    return Object.values(rows[0])[0]
  }

  assert.equal(await pragma('journal_mode'), 'wal')
  assert.equal(await pragma('synchronous'), 2)
  assert.equal(await pragma('foreign_keys'), 1)
  assert.equal(await pragma('busy_timeout'), 1000)
}).skip(process.env.DB_CLIENT !== 'sqlite', 'SQLite-only durability settings')

test('production migrations cannot roll back on any connection', ({ assert }) => {
  for (const [name, connection] of Object.entries(dbConfig.connections)) {
    assert.isTrue(connection.migrations?.disableRollbacksInProduction, name)
  }
})
