import { rejects } from 'node:assert/strict'
import { test } from '@japa/runner'
import type { AccountUser } from '@kevinjohn/adonisjs-account-kit'
import { defineConfig, errors } from '../index.ts'
import { accessControlKitCallbacks } from '../account_kit/main.ts'
import { loadRunner } from '../src/kit_transaction.ts'
import { bootTestApp } from './helpers/app.ts'

test('app-owned membership rows reject invalid status and required timestamps, including Account Kit export', async ({
  assert,
}) => {
  const fixture = await bootTestApp()
  const { db, names } = fixture
  const tableName = `${names.memberships}_app`
  try {
    const original = await fixture.app.container.make('access_control.manager')
    const access = defineConfig({ ...original.config, membershipsTable: tableName }).attach(
      db,
      await loadRunner()
    )
    fixture.app.container.bindValue('access_control.manager', access)
    await db.connection().schema.createTable(tableName, (table) => {
      table.increments('id')
      table.integer('scope_id')
      table.integer('user_id')
      table.string('role')
      table.string('status').nullable()
      table.string('created_at').nullable()
      table.string('updated_at').nullable()
    })
    const timestamp = '2026-01-01T10:00:00.000Z'
    const base = {
      scope_id: 1,
      user_id: 2,
      role: 'historical_role',
      status: 'active',
      created_at: timestamp,
      updated_at: timestamp,
    }
    await db.table(tableName).insert(base)
    const expected = await access.memberships.getMembership(1, 2)
    assert.deepEqual(await access.memberships.find(1, 2), expected)
    assert.equal(expected?.role, 'historical_role')
    assert.isNull(await access.memberships.getMembership(1, 9))
    assert.isNull(await access.memberships.find(1, 9))
    const callbacks = accessControlKitCallbacks()
    const exportData = () =>
      db.transaction((trx) => callbacks.exportAccountData({ id: 2 } as AccountUser, trx))
    assert.deepEqual(await exportData(), {
      memberships: [
        {
          scopeId: 1,
          role: 'historical_role',
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    })
    for (const [patch, message] of [
      [{ role: null }, 'invalid role'],
      [{ status: 'unknown' }, 'unsupported status'],
      [{ status: null }, 'unsupported status'],
      [{ created_at: null }, 'invalid created_at timestamp'],
      [{ created_at: 'not a timestamp' }, 'invalid created_at timestamp'],
      [{ updated_at: null }, 'invalid updated_at timestamp'],
      [{ updated_at: 'not a timestamp' }, 'invalid updated_at timestamp'],
    ] as const) {
      await db.from(tableName).update({ ...base, ...patch })
      for (const read of [
        () => access.memberships.getMembership(1, 2),
        () => access.memberships.find(1, 2),
        exportData,
      ]) {
        await rejects(read, (error: unknown) => {
          assert.instanceOf(error, errors.E_ACCESS_CONTROL_INVALID_CONFIG)
          const diagnostic = error as InstanceType<typeof errors.E_ACCESS_CONTROL_INVALID_CONFIG>
          assert.equal(diagnostic.code, 'E_ACCESS_CONTROL_INVALID_CONFIG')
          assert.equal(diagnostic.status, 500)
          assert.equal(diagnostic.message, `access-control: stored membership has an ${message}`)
          return true
        })
      }
    }
  } finally {
    await db.connection().schema.dropTableIfExists(tableName)
    await fixture.close()
  }
})
