// Specification 17.2: `access-control:doctor` over a booted application.
import { test } from '@japa/runner'
import { Kernel, ListLoader } from '@adonisjs/core/ace'
import AccessControlDoctor from '../commands/doctor.js'
import { AccessControl, defineAccessControl } from '../index.js'
import { accountKitVersions, runDoctor, type DoctorReport } from '../src/doctor.js'
import { sqlTimestamp } from '../src/kit_transaction.js'
import { bootTestApp, type TestApp } from './helpers/app.js'
import { createParentTable } from './helpers/schema.js'
import { permissions, roles } from './helpers/fixture.js'

function idOf(rows: unknown[]): number {
  const [row] = rows
  return Number(typeof row === 'object' && row !== null ? (row as { id: unknown }).id : row)
}

test.group('access-control:doctor (spec 17.2)', (group) => {
  let booted: TestApp
  let access: AccessControl
  group.setup(async () => {
    booted = await bootTestApp()
    access = await booted.app.container.make(AccessControl)
    return () => booted.close()
  })

  const createUser = async () =>
    idOf(await booted.db.table(booted.names.users).returning('id').insert({ name: 'u' }))
  const createScope = async () =>
    idOf(await booted.db.table(booted.names.scope).returning('id').insert({ name: 's' }))
  const rawMembership = async (
    scopeId: number,
    userId: number,
    role: string,
    status = 'active'
  ) => {
    const now = sqlTimestamp(booted.db)
    return idOf(
      await booted.db.table(booted.names.memberships).returning('id').insert({
        scope_id: scopeId,
        user_id: userId,
        role,
        status,
        created_at: now,
        updated_at: now,
      })
    )
  }
  const failing = (report: DoctorReport) =>
    Object.fromEntries(report.checks.filter((c) => !c.ok).map((c) => [c.name, c.sampleIds]))
  const rowCount = async () => {
    const [row] = await booted.db.from(booted.names.memberships).count('* as total')
    return Number(row.total)
  }
  const exec = async (...args: string[]) => {
    const kernel = new Kernel(booted.app)
    kernel.addLoader(new ListLoader([AccessControlDoctor]))
    kernel.ui.switchMode('raw')
    const command = await kernel.exec('access-control:doctor', args)
    const logs = (kernel.ui.logger.getLogs() as Array<{ message: string }>).map((l) => l.message)
    return { exitCode: command.exitCode, logs }
  }

  test('clean data passes every check and the command exits 0', async ({ assert }) => {
    const scope = await createScope()
    const [owner, editor] = await Promise.all([createUser(), createUser()])
    await access.memberships.createFirstMember({ scopeId: scope, userId: owner })
    await access.memberships.add({
      actor: { id: owner },
      scopeId: scope,
      userId: editor,
      role: 'editor',
    })
    const report = await runDoctor({ access, db: booted.db, scope })
    assert.deepEqual(failing(report), {})
    assert.deepEqual(
      report.checks.map((c) => c.name),
      [
        'memberships_table',
        'unknown_role',
        'unknown_status',
        'scope_without_owner',
        'scope_with_many_owners',
        'orphan_scope',
        'orphan_user',
      ]
    )
    for (const entry of report.checks)
      assert.deepEqual([entry.ok, entry.count, entry.sampleIds], [true, 0, []])
    const result = await exec(`--scope=${scope}`)
    assert.equal(result.exitCode, 0, result.logs.join('\n'))
    assert.isTrue(result.logs.some((line) => line.includes('unknown_role: 0')))
    assert.isTrue(result.logs.some((line) => line.includes('account_kit_version: 0')))
  })

  test('each check reports seeded bad rows with ids only; --scope filters; nothing is written', async ({
    assert,
  }) => {
    const [bad, clean, headless, crowded] = await Promise.all([
      createScope(),
      createScope(),
      createScope(),
      createScope(),
    ])
    const [owner, u1, u2, u3] = await Promise.all([
      createUser(),
      createUser(),
      createUser(),
      createUser(),
    ])
    await access.memberships.createFirstMember({ scopeId: bad, userId: owner })
    await access.memberships.createFirstMember({ scopeId: clean, userId: owner })
    await access.memberships.createFirstMember({ scopeId: crowded, userId: owner })
    const ghost = await rawMembership(bad, u1, 'ghost')
    const weird = await rawMembership(bad, u2, 'editor', 'archived')
    await rawMembership(headless, u3, 'editor')
    const second = await rawMembership(crowded, u1, 'owner')
    const before = await rowCount()

    const report = await runDoctor({ access, db: booted.db })
    assert.deepEqual(failing(report), {
      unknown_role: [String(ghost)],
      unknown_status: [String(weird)],
      scope_without_owner: [String(headless)],
      scope_with_many_owners: [String(crowded)],
    })
    const filtered = await runDoctor({ access, db: booted.db, scope: bad })
    assert.deepEqual(failing(filtered), {
      unknown_role: [String(ghost)],
      unknown_status: [String(weird)],
    })
    assert.deepEqual(failing(await runDoctor({ access, db: booted.db, scope: clean })), {})
    const json = await exec('--json')
    assert.equal(json.exitCode, 1)
    const printed = JSON.parse(json.logs.find((line) => line.startsWith('{'))!) as DoctorReport
    assert.deepEqual(Object.keys(printed), ['checks'])
    assert.deepEqual(Object.keys(printed.checks[0]), ['name', 'ok', 'count', 'sampleIds'])
    assert.deepEqual(failing(printed), {
      ...failing(report),
    })
    assert.equal(await rowCount(), before)
    await booted.db.from(booted.names.memberships).where('id', second).delete()
    await booted.db.from(booted.names.memberships).whereIn('id', [ghost, weird]).delete()
    await booted.db.from(booted.names.memberships).where('scope_id', headless).delete()
  })

  test('sample ids stop at 20 while the count is exact', async ({ assert }) => {
    const scope = await createScope()
    const ids: number[] = []
    for (let index = 0; index < 23; index++)
      ids.push(await rawMembership(scope, await createUser(), 'ghost'))
    const report = await runDoctor({ access, db: booted.db, scope })
    const unknownRole = report.checks.find((c) => c.name === 'unknown_role')!
    assert.equal(unknownRole.count, 23)
    assert.deepEqual(unknownRole.sampleIds, ids.slice(0, 20).map(String))
    await booted.db.from(booted.names.memberships).where('scope_id', scope).delete()
    const headless: number[] = []
    for (let index = 0; index < 21; index++) {
      const created = await createScope()
      headless.push(created)
      await rawMembership(created, await createUser(), 'editor')
    }
    const owners = await runDoctor({ access, db: booted.db })
    const withoutOwner = owners.checks.find((c) => c.name === 'scope_without_owner')!
    assert.equal(withoutOwner.count, 21)
    assert.deepEqual(
      withoutOwner.sampleIds,
      [...headless]
        .sort((a, b) => a - b)
        .slice(0, 20)
        .map(String)
    )
    await booted.db.from(booted.names.memberships).whereIn('scope_id', headless).delete()
  })

  test('orphans, a missing table and missing columns are reported; the Account Kit version is compared', async ({
    assert,
  }) => {
    const emptyUsers = `${booted.names.users}_empty`
    await createParentTable(booted.db, emptyUsers, 'integer')
    try {
      const scope = await createScope()
      const owner = await createUser()
      await access.memberships.createFirstMember({ scopeId: scope, userId: owner })
      const detached = defineAccessControl({
        roles: [...roles],
        ownerRole: 'owner',
        users: { table: emptyUsers, keyType: 'integer' },
        scope: { table: booted.names.scope, keyType: 'integer' },
        membershipsTable: booted.names.memberships,
        permissions,
      })
      const orphans = await runDoctor({
        access: detached as unknown as AccessControl,
        db: booted.db,
        scope,
      })
      const [membership] = await booted.db.from(booted.names.memberships).where('scope_id', scope)
      assert.deepEqual(failing(orphans), { orphan_user: [String(membership.id)] })
      const noTable = defineAccessControl({ ...detached.config, membershipsTable: 'no_such_table' })
      const missingTable = await runDoctor({
        access: noTable as unknown as AccessControl,
        db: booted.db,
        accountKit: { installed: '0.1.0', expected: '0.2.0' },
      })
      assert.deepEqual(
        missingTable.checks.map((c) => [c.name, c.ok, c.count]),
        [
          ['memberships_table', false, 1],
          ['account_kit_version', false, 1],
        ]
      )
      const sparse = defineAccessControl({ ...detached.config, membershipsTable: emptyUsers })
      const missingColumns = await runDoctor({
        access: sparse as unknown as AccessControl,
        db: booted.db,
      })
      assert.deepEqual(
        missingColumns.checks.map((c) => c.name),
        ['memberships_table']
      )
      assert.deepEqual(missingColumns.checks[0].sampleIds, [
        'scope_id',
        'user_id',
        'role',
        'status',
        'created_at',
        'updated_at',
      ])
      const versions = accountKitVersions()
      assert.equal(versions.expected, '0.2.0')
      assert.equal(versions.installed, '0.2.0')
    } finally {
      await booted.db.connection().schema.dropTableIfExists(emptyUsers)
    }
  })

  test('a malformed --scope exits 2', async ({ assert }) => {
    const result = await exec('--scope=not-a-scope')
    assert.equal(result.exitCode, 2)
    assert.isTrue(result.logs.some((line) => line.includes('the doctor could not run')))
  })
})
