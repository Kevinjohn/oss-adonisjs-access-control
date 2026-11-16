// Specification 17.2: `access-control:doctor` over a booted application.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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

  test('a role or status differing only by case is unknown, and an OWNER is not an owner', async ({
    assert,
  }) => {
    // The runtime refuses `EDITOR`; the doctor must not let a case-insensitive collation hide it.
    const scope = await createScope()
    const [u1, u2, u3] = await Promise.all([createUser(), createUser(), createUser()])
    const upperRole = await rawMembership(scope, u1, 'EDITOR')
    const upperStatus = await rawMembership(scope, u2, 'editor', 'ACTIVE')
    const upperOwner = await rawMembership(scope, u3, 'OWNER')
    const report = await runDoctor({ access, db: booted.db, scope })
    assert.deepEqual(failing(report), {
      unknown_role: [String(upperRole), String(upperOwner)],
      unknown_status: [String(upperStatus)],
      scope_without_owner: [String(scope)],
    })
    await booted.db
      .from(booted.names.memberships)
      .whereIn('id', [upperRole, upperStatus, upperOwner])
      .delete()
  })

  test('nullable schema drift reports null roles and statuses within the requested scope', async ({
    assert,
  }) => {
    const tableName = `${booted.names.memberships}_nullable`
    await booted.db.connection().schema.createTable(tableName, (table) => {
      table.increments('id')
      table.integer('scope_id')
      table.integer('user_id')
      table.string('role', 32).nullable()
      table.string('status', 16).nullable()
      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
    try {
      const [scope, otherScope] = await Promise.all([createScope(), createScope()])
      const [owner, u1, u2, u3] = await Promise.all([
        createUser(),
        createUser(),
        createUser(),
        createUser(),
      ])
      const now = sqlTimestamp(booted.db)
      const insert = async (
        scopeId: number,
        userId: number,
        role: string | null,
        status: string | null
      ) =>
        idOf(
          await booted.db.table(tableName).returning('id').insert({
            scope_id: scopeId,
            user_id: userId,
            role,
            status,
            created_at: now,
            updated_at: now,
          })
        )
      await insert(scope, owner, 'owner', 'active')
      const noRole = await insert(scope, u1, null, 'active')
      const noStatus = await insert(scope, u2, 'editor', null)
      const neither = await insert(scope, u3, null, null)
      await insert(otherScope, owner, null, null)
      const drifted = defineAccessControl({ ...access.config, membershipsTable: tableName })
      const report = await runDoctor({ access: drifted as AccessControl, db: booted.db, scope })
      assert.deepEqual(failing(report), {
        unknown_role: [String(noRole), String(neither)],
        unknown_status: [String(noStatus), String(neither)],
      })
      assert.deepEqual(
        report.checks.filter((entry) => !entry.ok).map((entry) => entry.count),
        [2, 2]
      )
    } finally {
      await booted.db.connection().schema.dropTable(tableName)
    }
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
      assert.equal(versions.expected, '0.4.0')
      assert.equal(versions.installed, '0.4.0')
    } finally {
      await booted.db.connection().schema.dropTableIfExists(emptyUsers)
    }
  })

  test('Account Kit missing is a mismatch; an unreadable installed manifest cannot be checked', async ({
    assert,
  }) => {
    const notFound = Object.assign(new Error('not found'), { code: 'ERR_MODULE_NOT_FOUND' })
    assert.deepEqual(
      accountKitVersions(() => {
        throw notFound
      }),
      { installed: null, expected: '0.4.0' }
    )
    const other = Object.assign(new Error('bad exports'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
    assert.throws(
      () =>
        accountKitVersions(() => {
          throw other
        }),
      'bad exports'
    )

    const root = await mkdtemp(join(tmpdir(), 'access-control-doctor-'))
    try {
      const manifest = join(root, 'package.json')
      const entry = pathToFileURL(join(root, 'build', 'index.js')).href
      await mkdir(join(root, 'build'))
      await writeFile(manifest, '{"name":"@kevinjohn/adonisjs-account-kit",')
      assert.throws(() => accountKitVersions(() => entry), /cannot read .*package\.json/)
      await writeFile(manifest, '{"name":"@kevinjohn/adonisjs-account-kit"}')
      assert.throws(() => accountKitVersions(() => entry), /installed manifest has no version/)
      await writeFile(manifest, '{"name":"@kevinjohn/adonisjs-account-kit","version":"0.3.3"}')
      assert.deepEqual(
        accountKitVersions(() => entry),
        { installed: '0.3.3', expected: '0.4.0' }
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('the command reports a version mismatch with exit 1 and an unreadable manifest with exit 2', async ({
    assert,
  }) => {
    const run = async (versions: () => { installed: string | null; expected: string }) => {
      class Probe extends AccessControlDoctor {
        protected accountKitVersions() {
          return versions()
        }
      }
      const kernel = new Kernel(booted.app)
      kernel.addLoader(new ListLoader([Probe]))
      kernel.ui.switchMode('raw')
      const command = await kernel.exec('access-control:doctor', [])
      const logs = (kernel.ui.logger.getLogs() as Array<{ message: string }>).map((l) => l.message)
      return { exitCode: command.exitCode, logs }
    }
    const missing = await run(() => ({ installed: null, expected: '0.4.0' }))
    assert.equal(missing.exitCode, 1)
    assert.isTrue(missing.logs.some((line) => line.includes('account_kit_version: 1')))
    const unreadable = await run(() => {
      throw new Error('@kevinjohn/adonisjs-account-kit: cannot read package.json')
    })
    assert.equal(unreadable.exitCode, 2)
    assert.isTrue(
      unreadable.logs.some((line) =>
        line.includes('the doctor could not run: @kevinjohn/adonisjs-account-kit: cannot read')
      )
    )
  })

  test('a malformed --scope exits 2', async ({ assert }) => {
    const result = await exec('--scope=not-a-scope')
    assert.equal(result.exitCode, 2)
    assert.isTrue(result.logs.some((line) => line.includes('the doctor could not run')))
  })

  test('schema findings take precedence over a malformed scope in the command', async ({
    assert,
  }) => {
    const fixture = await bootTestApp()
    try {
      const original = await fixture.app.container.make(AccessControl)
      const commandFor = async (table: string) => {
        const configured = defineAccessControl({ ...original.config, membershipsTable: table })
        fixture.app.container.bindValue(AccessControl, configured as AccessControl)
        const kernel = new Kernel(fixture.app)
        kernel.addLoader(new ListLoader([AccessControlDoctor]))
        kernel.ui.switchMode('raw')
        const command = await kernel.exec('access-control:doctor', ['--scope=bad', '--json'])
        const logs = (kernel.ui.logger.getLogs() as Array<{ message: string }>).map(
          (log) => log.message
        )
        return { exitCode: command.exitCode, logs }
      }
      const absent = await commandFor('missing_memberships')
      assert.equal(absent.exitCode, 1, absent.logs.join('\n'))
      assert.equal(
        JSON.parse(absent.logs.find((line) => line.startsWith('{'))!).checks[0].name,
        'memberships_table'
      )
      const sparse = `${fixture.names.users}_sparse`
      await createParentTable(fixture.db, sparse, 'integer')
      const columns = await commandFor(sparse)
      assert.equal(columns.exitCode, 1, columns.logs.join('\n'))
      assert.include(
        JSON.parse(columns.logs.find((line) => line.startsWith('{'))!).checks[0].sampleIds,
        'scope_id'
      )
      const validSchema = await commandFor(fixture.names.memberships)
      assert.equal(validSchema.exitCode, 2)
      assert.isTrue(validSchema.logs.some((line) => line.includes('the doctor could not run')))
    } finally {
      await fixture.close()
    }
  })
})
