// Specification 17.2: `access-control:doctor` over a booted application.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from '@japa/runner'
import { Kernel, ListLoader } from '@adonisjs/core/ace'
import AccessControlDoctor from '../commands/doctor.ts'
import { type AccessControl, defineAccessControl } from '../index.ts'
import { matchesAccountKitVersion, readAccountKitVersions, runDoctor } from '../src/doctor.ts'
import { sqlTimestamp } from '../src/kit_transaction.ts'
import { bootTestApp, type TestApp } from './helpers/app.ts'
import { testEngine } from './helpers/database.ts'
import { createParentTable } from './helpers/schema.ts'
import { permissions, roles } from './helpers/fixture.ts'

function idOf(rows: unknown[]): number {
  const [row] = rows
  return Number(typeof row === 'object' && row !== null ? (row as { id: unknown }).id : row)
}

async function runCommand(fixture: TestApp, ...args: string[]) {
  const kernel = new Kernel(fixture.app)
  kernel.addLoader(new ListLoader([AccessControlDoctor]))
  kernel.ui.switchMode('raw')
  const command = await kernel.exec('access-control:doctor', args)
  const logs = (kernel.ui.logger.getLogs() as Array<{ message: string }>).map((log) => log.message)
  return { exitCode: command.exitCode, logs }
}

test('matchesAccountKitVersion accepts compatible caret patches and refuses other minors or prereleases', ({
  assert,
}) => {
  assert.isFalse(matchesAccountKitVersion(null, '^0.2.0'))
  assert.isTrue(matchesAccountKitVersion('0.2.0', '0.2.0'))
  assert.isFalse(matchesAccountKitVersion('0.1.0', '0.2.0'))
  assert.isFalse(matchesAccountKitVersion('0.2.0-rc.1', '^0.2.0'))
  assert.isFalse(matchesAccountKitVersion('0.2.0', '^invalid'))

  assert.isTrue(matchesAccountKitVersion('0.2.0', '^0.2.0'))
  assert.isTrue(matchesAccountKitVersion('0.2.1', '^0.2.0'))
  assert.isFalse(matchesAccountKitVersion('0.3.0', '^0.2.0'))
  assert.isFalse(matchesAccountKitVersion('0.1.9', '^0.2.0'))

  assert.isTrue(matchesAccountKitVersion('1.2.3', '^1.2.3'))
  assert.isTrue(matchesAccountKitVersion('1.3.0', '^1.2.3'))
  assert.isFalse(matchesAccountKitVersion('1.2.2', '^1.2.3'))
  assert.isFalse(matchesAccountKitVersion('2.0.0', '^1.2.3'))

  assert.isTrue(matchesAccountKitVersion('0.0.1', '^0.0.1'))
  assert.isFalse(matchesAccountKitVersion('0.0.2', '^0.0.1'))
})

test.group('access-control:doctor (spec 17.2)', (group) => {
  let booted: TestApp
  let access: AccessControl
  group.setup(async () => {
    booted = await bootTestApp()
    access = await booted.app.container.make('access_control.manager')
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
        'memberships_unique_scope_user',
        'memberships_scope_foreign_key',
        'memberships_user_foreign_key',
        'unknown_role',
        'unknown_status',
        'invalid_timestamp',
        'scope_without_owner',
        'scope_with_many_owners',
        'orphan_scope',
        'orphan_user',
      ]
    )
    for (const entry of report.checks)
      assert.deepEqual([entry.ok, entry.count, entry.sampleIds], [true, 0, []])
    const result = await runCommand(booted, `--scope=${scope}`)
    assert.equal(result.exitCode, 0, result.logs.join('\n'))
    assert.isTrue(result.logs.some((line) => line.includes('unknown_role: 0')))
    assert.isTrue(result.logs.some((line) => line.includes('account_kit_version: 0')))
  })

  test('checks empty app-owned tables for the scope/user unique pair and each restrictive reference', async ({
    assert,
  }) => {
    const fixture = await bootTestApp()
    const original = await fixture.app.container.make('access_control.manager')
    const { db, names } = fixture
    const tableName = `${names.memberships}_app`
    try {
      for (const variant of [
        'equivalent',
        'no_unique',
        'no_scope',
        'no_user',
        'wrong_parent',
        'cascade',
      ] as const) {
        await db.connection().schema.createTable(tableName, (table) => {
          table.increments('id')
          table.integer('scope_id').unsigned().notNullable()
          table.integer('user_id').unsigned().notNullable()
          table.string('role').notNullable()
          table.string('status').notNullable()
          table.timestamp('created_at').notNullable()
          table.timestamp('updated_at').notNullable()
          if (variant !== 'no_unique') table.unique(['user_id', 'scope_id'], `${tableName}_pair`)
          else table.unique(['user_id', 'scope_id', 'role'], `${tableName}_wider`)
          if (variant !== 'no_scope')
            table.foreign('scope_id').references('id').inTable(names.scope).onDelete('NO ACTION')
          if (variant !== 'no_user')
            table
              .foreign('user_id')
              .references('id')
              .inTable(variant === 'wrong_parent' ? names.scope : names.users)
              .onDelete(variant === 'cascade' ? 'CASCADE' : 'RESTRICT')
        })
        const adopted = defineAccessControl({ ...original.config, membershipsTable: tableName })
        fixture.app.container.bindValue('access_control.manager', adopted as AccessControl)
        const expected = {
          equivalent: [],
          no_unique: ['memberships_unique_scope_user'],
          no_scope: ['memberships_scope_foreign_key'],
          no_user: ['memberships_user_foreign_key'],
          wrong_parent: ['memberships_user_foreign_key'],
          cascade: ['memberships_user_foreign_key'],
        }[variant]
        const json = await runCommand(fixture, '--json')
        assert.equal(json.exitCode, expected.length ? 1 : 0, json.logs.join('\n'))
        const printed = JSON.parse(json.logs.find((line) => line.startsWith('{'))!) as DoctorReport
        assert.deepEqual(Object.keys(failing(printed)), expected, variant)
        const cli = await runCommand(fixture)
        assert.equal(cli.exitCode, json.exitCode, cli.logs.join('\n'))
        for (const name of expected)
          assert.isTrue(cli.logs.some((line) => line.includes(`${name}: 1`)))
        await db.connection().schema.dropTable(tableName)
      }
    } finally {
      await db.connection().schema.dropTableIfExists(tableName)
      await fixture.close()
    }
  })

  test('SQLite resolves equivalent referenced identifiers and implicit primary keys', async ({
    assert,
  }) => {
    const client = booted.db.connection()
    const tableName = `${booted.names.memberships}_app`
    const usersTable = `${booted.names.users}_app`
    const scopeTable = booted.names.scope.toUpperCase()
    const adopted = defineAccessControl({
      ...access.config,
      membershipsTable: tableName,
      users: { ...access.config.users, table: usersTable },
    })

    for (const [userColumns, expectedFailures] of [
      ['id integer primary key', []],
      ['id integer unique, alternate_id integer primary key', ['memberships_user_foreign_key']],
      [
        'id integer unique, alternate_id integer, primary key (alternate_id, id)',
        ['memberships_user_foreign_key'],
      ],
    ] as const) {
      try {
        await client.rawQuery(`create table "${usersTable}" (${userColumns})`)
        await client.rawQuery(`create table "${tableName}" (
          id integer primary key,
          scope_id integer not null references "${scopeTable}" ("ID") on delete restrict,
          user_id integer not null references "${usersTable}" on delete restrict,
          role text not null,
          status text not null,
          created_at text not null,
          updated_at text not null,
          unique (scope_id, user_id)
        )`)
        const report = await runDoctor({ access: adopted as AccessControl, db: booted.db })
        assert.deepEqual(Object.keys(failing(report)), expectedFailures)
      } finally {
        await client.schema.dropTableIfExists(tableName)
        await client.schema.dropTableIfExists(usersTable)
      }
    }
  }).skip(testEngine !== 'sqlite', 'SQLite reference metadata')

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
    const json = await runCommand(booted, '--json')
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
        memberships_unique_scope_user: [],
        memberships_scope_foreign_key: [],
        memberships_user_foreign_key: [],
        unknown_role: [String(noRole), String(neither)],
        unknown_status: [String(noStatus), String(neither)],
      })
      assert.deepEqual(
        report.checks.filter((entry) => !entry.ok).map((entry) => entry.count),
        [1, 1, 1, 2, 2]
      )
    } finally {
      await booted.db.connection().schema.dropTable(tableName)
    }
  })

  test('app-owned rows with a NULL or unreadable timestamp are reported within the requested scope', async ({
    assert,
  }) => {
    const tableName = `${booted.names.memberships}_loose_times`
    await booted.db.connection().schema.createTable(tableName, (table) => {
      table.increments('id')
      table.integer('scope_id')
      table.integer('user_id')
      table.string('role', 32)
      table.string('status', 16)
      table.string('created_at', 40).nullable()
      table.timestamp('updated_at').nullable()
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
      const insert = async (userId: number, createdAt: string | null, updatedAt: string | null) =>
        idOf(
          await booted.db
            .table(tableName)
            .returning('id')
            .insert({
              scope_id: userId === u3 ? otherScope : scope,
              user_id: userId,
              role: 'owner',
              status: userId === owner ? 'active' : 'suspended',
              created_at: createdAt,
              updated_at: updatedAt,
            })
        )
      await insert(owner, now, now)
      const noUpdatedAt = await insert(u1, now, null)
      const unreadable = await insert(u2, 'not a timestamp', now)
      await insert(u3, null, null)
      const drifted = defineAccessControl({ ...access.config, membershipsTable: tableName })
      const report = await runDoctor({ access: drifted as AccessControl, db: booted.db, scope })
      const check = report.checks.find((entry) => entry.name === 'invalid_timestamp')
      assert.deepEqual(check, {
        name: 'invalid_timestamp',
        ok: false,
        count: 2,
        sampleIds: [String(noUpdatedAt), String(unreadable)],
      })
      const unscoped = await runDoctor({ access: drifted as AccessControl, db: booted.db })
      assert.equal(unscoped.checks.find((entry) => entry.name === 'invalid_timestamp')?.count, 3)
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
    const multiple: number[] = []
    for (let index = 0; index < 21; index++) {
      const created = await createScope()
      headless.push(created)
      await rawMembership(created, await createUser(), 'editor')
      const duplicated = await createScope()
      multiple.push(duplicated)
      await rawMembership(duplicated, await createUser(), 'owner')
      await rawMembership(duplicated, await createUser(), 'owner')
    }
    const knex = booted.db.connection().getReadClient()
    const ownerQueries: string[] = []
    const capture = ({ sql }: { sql: string }) => {
      if (sql.toLowerCase().includes('having sum(')) ownerQueries.push(sql)
    }
    knex.on('query', capture)
    let owners: DoctorReport
    try {
      owners = await runDoctor({ access, db: booted.db })
    } finally {
      knex.off('query', capture)
    }
    assert.lengthOf(ownerQueries, 2)
    for (const query of ownerQueries) {
      assert.match(query, /count\(\*\) over\(\)/i)
      assert.match(query, /\blimit\b/i)
    }
    const withoutOwner = owners.checks.find((c) => c.name === 'scope_without_owner')!
    const manyOwners = owners.checks.find((c) => c.name === 'scope_with_many_owners')!
    assert.equal(withoutOwner.count, 21)
    assert.deepEqual(
      withoutOwner.sampleIds,
      [...headless]
        .sort((a, b) => a - b)
        .slice(0, 20)
        .map(String)
    )
    assert.equal(manyOwners.count, 21)
    assert.deepEqual(
      manyOwners.sampleIds,
      multiple
        .sort((a, b) => a - b)
        .slice(0, 20)
        .map(String)
    )
    await booted.db
      .from(booted.names.memberships)
      .whereIn('scope_id', [...headless, ...multiple])
      .delete()
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
      assert.deepEqual(failing(orphans), {
        memberships_user_foreign_key: [],
        orphan_user: [String(membership.id)],
      })
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
      const patchMatch = await runDoctor({
        access,
        db: booted.db,
        accountKit: { installed: '0.2.1', expected: '^0.2.0' },
      })
      assert.equal(patchMatch.checks.find((c) => c.name === 'account_kit_version')?.ok, true)
      const minorMismatch = await runDoctor({
        access,
        db: booted.db,
        accountKit: { installed: '0.3.0', expected: '^0.2.0' },
      })
      assert.equal(minorMismatch.checks.find((c) => c.name === 'account_kit_version')?.ok, false)
      const versions = readAccountKitVersions()
      assert.equal(versions.expected, '^0.8.0')
      assert.equal(versions.installed, '0.8.0')
    } finally {
      await booted.db.connection().schema.dropTableIfExists(emptyUsers)
    }
  })

  test('Account Kit missing is a mismatch; an unreadable installed manifest cannot be checked', async ({
    assert,
  }) => {
    const notFound = Object.assign(new Error('not found'), { code: 'ERR_MODULE_NOT_FOUND' })
    assert.deepEqual(
      readAccountKitVersions(() => {
        throw notFound
      }),
      { installed: null, expected: '^0.8.0' }
    )
    const other = Object.assign(new Error('bad exports'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
    assert.throws(
      () =>
        readAccountKitVersions(() => {
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
      assert.throws(() => readAccountKitVersions(() => entry), /cannot read .*package\.json/)
      await writeFile(manifest, '{"name":"@kevinjohn/adonisjs-account-kit"}')
      assert.throws(() => readAccountKitVersions(() => entry), /installed manifest has no version/)
      await writeFile(manifest, '{"name":"@kevinjohn/adonisjs-account-kit","version":"0.3.3"}')
      assert.deepEqual(
        readAccountKitVersions(() => entry),
        { installed: '0.3.3', expected: '^0.8.0' }
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
    const missing = await run(() => ({ installed: null, expected: '^0.8.0' }))
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
    const result = await runCommand(booted, '--scope=not-a-scope')
    assert.equal(result.exitCode, 2)
    assert.isTrue(result.logs.some((line) => line.includes('the doctor could not run')))
  })

  test('schema findings take precedence over a malformed scope in the command', async ({
    assert,
  }) => {
    const fixture = await bootTestApp()
    try {
      const original = await fixture.app.container.make('access_control.manager')
      const commandFor = async (table: string) => {
        const configured = defineAccessControl({ ...original.config, membershipsTable: table })
        fixture.app.container.bindValue('access_control.manager', configured as AccessControl)
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

// SQLite allows the parent and membership columns to use different collations.
if (testEngine === 'sqlite') {
  test.group('access-control:doctor with SQLite string keys', () => {
    for (const caseInsensitiveKeys of [true, false]) {
      test(`scoped doctor checks stored string keys with ${caseInsensitiveKeys ? 'case-insensitive' : 'case-sensitive'} parents`, async ({
        assert,
      }) => {
        const fixture = await bootTestApp({
          keyTypes: { users: 'integer', scope: 'string' },
          caseInsensitiveKeys,
        })
        try {
          const { db, names } = fixture
          const access = await fixture.app.container.make('access_control.manager')
          const stored = 'West'
          const alternate = 'west'
          const unrelated = 'East'
          const clean = caseInsensitiveKeys ? [unrelated] : [unrelated, alternate]
          await db.table(names.scope).insert([stored, ...clean].map((id) => ({ id, name: id })))
          const userId = idOf(
            await db.table(names.users).returning('id').insert({ name: 'member' })
          )
          for (const scopeId of clean)
            await access.memberships.createFirstMember({ scopeId, userId })
          const now = sqlTimestamp(db)
          const badId = idOf(
            await db.table(names.memberships).returning('id').insert({
              scope_id: stored,
              user_id: userId,
              role: 'legacy',
              status: 'active',
              created_at: now,
              updated_at: now,
            })
          )
          const allMemberships = () => db.from(names.memberships).orderBy('id')
          const before = await allMemberships()

          for (const scope of [stored, alternate, unrelated]) {
            const result = await runCommand(fixture, `--scope=${scope}`, '--json')
            const report = JSON.parse(
              result.logs.find((line) => line.startsWith('{'))!
            ) as DoctorReport
            const findings = report.checks.filter((entry) => !entry.ok)
            if (clean.includes(scope)) {
              assert.equal(result.exitCode, 0, scope)
              assert.deepEqual(findings, [], scope)
            } else {
              assert.equal(result.exitCode, 1, scope)
              assert.deepEqual(
                findings.map((entry) => [entry.name, entry.count, entry.sampleIds]),
                [
                  ['unknown_role', 1, [String(badId)]],
                  ['scope_without_owner', 1, [stored]],
                ],
                scope
              )
            }
          }
          assert.deepEqual(await allMemberships(), before)
        } finally {
          await fixture.close()
        }
      })
    }
  })
}

import type { DoctorReport } from '../src/types.ts'
