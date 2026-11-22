// Specification section 11: `node ace configure` on a fresh application with Account Kit.
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from '@japa/runner'
import { Kernel, ListLoader } from '@adonisjs/core/ace'
import Configure from '@adonisjs/core/commands/configure'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { configureWith, manualSteps } from '../configure.js'
import { stubsRoot } from '../stubs/main.js'
import { renderMembershipsStub } from './helpers/schema.js'
import { testDatabase } from './helpers/database.js'
import { sourceFiles } from '@adonisjs/lucid/utils'
import type { BaseSchema } from '@adonisjs/lucid/schema'
import { planMigrations } from '../src/migration_order.js'

const packageName = '@kevinjohn/adonisjs-access-control'
const kernelSource = [
  "import router from '@adonisjs/core/services/router'",
  "import server from '@adonisjs/core/services/server'",
  '',
  'server.use([])',
  'router.use([])',
  '',
  'export const middleware = router.named({',
  "  auth: () => import('#middleware/auth_middleware'),",
  '})',
  '',
].join('\n')

async function freshApp(
  options: {
    accountKit?: boolean
    stubs?: string
    configPath?: string
    migrationPath?: string
    interactive?: boolean
    promptScope?: string
  } = {}
) {
  const root = await mkdtemp(join(tmpdir(), 'access_control_configure_'))
  const configPath = options.configPath ?? 'config'
  const migrationPath = options.migrationPath ?? 'database/migrations'
  const directories = { config: configPath, migrations: migrationPath }
  await writeFile(
    join(root, 'package.json'),
    '{"type":"module","devDependencies":{"@adonisjs/assembler":"8.6.0"}}'
  )
  await writeFile(join(root, 'tsconfig.json'), '{}')
  await writeFile(
    join(root, 'adonisrc.ts'),
    `import { defineConfig } from '@adonisjs/core/app'\nexport default defineConfig({ commands: [], providers: [], directories: ${JSON.stringify(directories)} })\n`
  )
  await mkdir(join(root, 'start'))
  await writeFile(join(root, 'start', 'kernel.ts'), kernelSource)
  await mkdir(join(root, configPath), { recursive: true })
  if (options.accountKit !== false)
    await writeFile(join(root, configPath, 'account_kit.ts'), 'export default {}\n')
  await symlink(
    fileURLToPath(new URL('../node_modules', import.meta.url)),
    join(root, 'node_modules')
  )
  const stubs = options.stubs ?? stubsRoot
  const importer = (specifier: string) =>
    specifier === packageName
      ? Promise.resolve({
          configure: (command: Configure) =>
            configureWith(command, stubs, options.interactive ?? false),
        })
      : import(specifier)
  const ignitor = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({
      rcFileContents: {
        directories,
        providers: [],
        commands: [async () => new ListLoader([Configure])],
      },
    })
    .create(pathToFileURL(`${root}/`), { importer })
  const read = (path: string) => readFile(join(root, path), 'utf8')
  const migrations = async () => {
    try {
      const files = await readdir(join(root, migrationPath))
      return files.sort()
    } catch {
      return []
    }
  }
  const run = async (...flags: string[]) => {
    const app = ignitor.createApp('console')
    await app.init()
    const kernel = new Kernel(app)
    kernel.addLoader(new ListLoader([Configure]))
    kernel.ui.switchMode('raw')
    if (options.promptScope) kernel.prompt.trap('scope-table').replyWith(options.promptScope)
    try {
      const command = await kernel.exec('configure', [packageName, '--force', ...flags])
      return {
        exitCode: command.exitCode,
        logs: (kernel.ui.logger.getLogs() as Array<{ message: string }>).map((log) => log.message),
      }
    } finally {
      await app.terminate()
    }
  }
  return { root, read, migrations, run, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test.group('configure (spec 11)', (group) => {
  // Codemods load the Assembler TypeScript project; each run takes seconds.
  group.each.timeout(60_000)

  test('writes every file on a fresh app and a re-run changes nothing', async ({ assert }) => {
    const app = await freshApp()
    try {
      const first = await app.run('--scope-table=teams')
      assert.equal(first.exitCode, 0, first.logs.join('\n'))
      const config = await app.read('config/access_control.ts')
      assert.include(config, `from '${packageName}'`)
      assert.include(config, "users: { table: 'users', keyType: 'integer' }")
      assert.include(config, "scope: { table: 'teams', keyType: 'integer' }")
      assert.include(config, "membershipsTable: 'memberships'")
      assert.include(config, "invitations: { manage: 'admin' }")
      const files = await app.migrations()
      assert.lengthOf(files, 1)
      assert.match(files[0], /^\d+_access_control_create_memberships\.ts$/)
      const migration = await app.read(`database/migrations/${files[0]}`)
      const rendered = await renderMembershipsStub({
        membershipsTable: 'memberships',
        usersTable: 'users',
        userKeyType: 'integer',
        scopeTable: 'teams',
        scopeKeyType: 'integer',
      })
      assert.equal(migration.trim(), rendered.trim())
      const rc = await app.read('adonisrc.ts')
      assert.lengthOf(rc.match(/access_control_provider/g) ?? [], 1)
      assert.include(rc, `() => import('${packageName}/commands')`)
      const kernel = await app.read('start/kernel.ts')
      assert.include(kernel, `scope: () => import('${packageName}/middleware')`)
      assert.include(kernel, "auth: () => import('#middleware/auth_middleware')")
      assert.isTrue(first.logs.some((line) => line.includes(manualSteps.split('\n')[0])))

      await writeFile(join(app.root, 'config', 'access_control.ts'), '// app-owned\n')
      const second = await app.run('--scope-table=teams')
      assert.equal(second.exitCode, 0)
      assert.equal(await app.read('config/access_control.ts'), '// app-owned\n')
      assert.deepEqual(await app.migrations(), files)
      assert.equal(await app.read(`database/migrations/${files[0]}`), migration)
      assert.equal(await app.read('adonisrc.ts'), rc)
      assert.equal(await app.read('start/kernel.ts'), kernel)
      assert.isTrue(
        second.logs.some((line) =>
          line.includes('Skipped database/migrations/*_access_control_create_memberships.ts')
        )
      )
    } finally {
      await app.cleanup()
    }
  })

  test('flags select the tables and key types', async ({ assert }) => {
    const app = await freshApp()
    try {
      const result = await app.run(
        '--scope-table=organisations',
        '--scope-id-type=uuid',
        '--users-table=accounts',
        '--user-id-type=string',
        '--memberships-table=organisation_members'
      )
      assert.equal(result.exitCode, 0, result.logs.join('\n'))
      const config = await app.read('config/access_control.ts')
      assert.include(config, "users: { table: 'accounts', keyType: 'string' }")
      assert.include(config, "scope: { table: 'organisations', keyType: 'uuid' }")
      assert.include(config, "membershipsTable: 'organisation_members'")
      const [file] = await app.migrations()
      const migration = await app.read(`database/migrations/${file}`)
      assert.include(migration, "table.uuid('scope_id')")
      assert.include(migration, "table.string('user_id', 254)")
      assert.include(migration, "'organisation_members'")
    } finally {
      await app.cleanup()
    }
  })

  test('prompts only in interactive setup and honours an explicit scope flag', async ({
    assert,
  }) => {
    const prompted = await freshApp({ interactive: true, promptScope: 'groups' })
    const flagged = await freshApp({ interactive: true, promptScope: 'ignored' })
    try {
      const first = await prompted.run()
      assert.equal(first.exitCode, 0, first.logs.join('\n'))
      assert.include(await prompted.read('config/access_control.ts'), "scope: { table: 'groups'")
      const second = await flagged.run('--scope-table=teams')
      assert.equal(second.exitCode, 0, second.logs.join('\n'))
      assert.include(await flagged.read('config/access_control.ts'), "scope: { table: 'teams'")
    } finally {
      await prompted.cleanup()
      await flagged.cleanup()
    }
  })

  test('preserves the Lucid identity of a nested membership migration on rerun', async ({
    assert,
  }) => {
    const app = await freshApp()
    const readInventory = async () => {
      const { files } = await sourceFiles(
        pathToFileURL(app.root + '/'),
        'database/migrations',
        false
      )
      return files.map(({ name }) => name)
    }
    try {
      const flags = ['--scope-table=teams']
      const first = await app.run(...flags)
      assert.equal(first.exitCode, 0, first.logs.join('\n'))
      const [original] = await app.migrations()
      const directory = join(app.root, 'database/migrations')
      const nested = `prior/${original}`
      const originalSource = await app.read(`database/migrations/${original}`)
      await mkdir(join(directory, 'prior'))
      await rename(join(directory, original), join(directory, nested))
      const before = await readInventory()
      assert.deepEqual(before, [`database/migrations/${nested.slice(0, -3)}`])
      const second = await app.run(...flags)
      assert.equal(second.exitCode, 0, second.logs.join('\n'))
      assert.deepEqual(await readInventory(), before)
      assert.equal(await app.read(`database/migrations/${nested}`), originalSource)
    } finally {
      await app.cleanup()
    }
  })

  test('a first install blocked by a nested migration names the file and --migration-path', async ({
    assert,
  }) => {
    const app = await freshApp()
    try {
      const directory = join(app.root, 'database/migrations')
      const users = '1795000000000_create_users_table.ts'
      const tenant = 'tenant/1795000000001_create_tenant_things.ts'
      await mkdir(join(directory, 'tenant'), { recursive: true })
      await writeFile(join(directory, users), '// app-owned\n')
      await writeFile(join(directory, tenant), '// app-owned\n')
      const refused = await app.run('--scope-table=teams')
      assert.equal(refused.exitCode, 1, refused.logs.join('\n'))
      const message = refused.logs.join('\n')
      assert.include(message, `${tenant} sorts after the new`)
      assert.include(message, '--migration-path')
      assert.deepEqual(await app.migrations(), [users, 'tenant'])
      assert.deepEqual(await readdir(join(directory, 'tenant')), [tenant.slice('tenant/'.length)])
      assert.deepEqual(await readdir(join(app.root, 'config')), ['account_kit.ts'])
      const nested = await app.run(
        '--scope-table=teams',
        '--migration-path=database/migrations/tenant'
      )
      assert.equal(nested.exitCode, 0, nested.logs.join('\n'))
      const written = await readdir(join(directory, 'tenant'))
      assert.lengthOf(written, 2)
      assert.match(written.sort()[1], /^\d+_access_control_create_memberships\.ts$/)
    } finally {
      await app.cleanup()
    }
  })

  test('publishes a later released migration beside a nested existing one', async ({ assert }) => {
    const extended = await mkdtemp(join(tmpdir(), 'access_control_stubs_'))
    const app = await freshApp({ stubs: extended })
    try {
      await cp(stubsRoot, extended, { recursive: true })
      const first = await app.run('--scope-table=teams')
      assert.equal(first.exitCode, 0, first.logs.join('\n'))
      const [original] = await app.migrations()
      const directory = join(app.root, 'database/migrations')
      await mkdir(join(directory, 'prior'))
      await rename(join(directory, original), join(directory, 'prior', original))
      await writeFile(join(directory, '1795000000000_create_users_table.ts'), '// app-owned\n')
      await writeFile(
        join(extended, 'migrations', 'released.json'),
        JSON.stringify([
          { name: 'access_control_create_memberships' },
          { name: 'add_membership_notes' },
        ])
      )
      await writeFile(
        join(extended, 'migrations', 'add_membership_notes.stub'),
        '{{{ exports({ to: migration.destination }) }}}\n// notes for {{ membershipsTable }}\n'
      )
      const second = await app.run('--scope-table=teams')
      assert.equal(second.exitCode, 0, second.logs.join('\n'))
      const prior = await readdir(join(directory, 'prior'))
      prior.sort()
      assert.lengthOf(prior, 2)
      assert.equal(prior[0], original)
      assert.match(prior[1], /^\d+_add_membership_notes\.ts$/)
      assert.deepEqual(await app.migrations(), ['1795000000000_create_users_table.ts', 'prior'])
    } finally {
      await app.cleanup()
      await rm(extended, { recursive: true, force: true })
    }
  })

  test('uses the host config and migrations directories and leaves existing files intact', async ({
    assert,
  }) => {
    const app = await freshApp({ configPath: 'settings', migrationPath: 'db/changes' })
    try {
      const first = await app.run('--scope-table=teams')
      assert.equal(first.exitCode, 0, first.logs.join('\n'))
      assert.include(await app.read('settings/access_control.ts'), "scope: { table: 'teams'")
      const files = await app.migrations()
      assert.lengthOf(files, 1)
      const second = await app.run('--scope-table=teams')
      assert.equal(second.exitCode, 0)
      assert.deepEqual(await app.migrations(), files)
    } finally {
      await app.cleanup()
    }
  })

  test('an explicit migration path selects a Lucid destination instead of the RC default', async ({
    assert,
  }) => {
    const app = await freshApp()
    try {
      const result = await app.run('--scope-table=teams', '--migration-path=database/custom')
      assert.equal(result.exitCode, 0, result.logs.join('\n'))
      const files = await readdir(join(app.root, 'database/custom'))
      assert.lengthOf(files, 1)
      assert.match(files[0], /^\d+_access_control_create_memberships\.ts$/)
      assert.deepEqual(await app.migrations(), [])
      const again = await app.run('--scope-table=teams', '--migration-path=database/custom')
      assert.equal(again.exitCode, 0, again.logs.join('\n'))
      assert.deepEqual(await readdir(join(app.root, 'database/custom')), files)
    } finally {
      await app.cleanup()
    }
  })

  test('generates after future-dated parents and runs the generated sequence on the test database', async ({
    assert,
  }) => {
    const app = await freshApp()
    const fixture = await testDatabase()
    const users = `users_${fixture.suffix}`
    const teams = `teams_${fixture.suffix}`
    const memberships = `memberships_${fixture.suffix}`
    try {
      const directory = join(app.root, 'database/migrations')
      await mkdir(directory, { recursive: true })
      const parents = [
        [`2999999999998_create_users.ts`, users],
        [`2999999999999_create_teams.ts`, teams],
      ] as const
      for (const [filename, table] of parents) {
        await writeFile(
          join(directory, filename),
          `import { BaseSchema } from '@adonisjs/lucid/schema'\nexport default class extends BaseSchema { async up() { this.schema.createTable('${table}', (t) => t.increments('id')) } }\n`
        )
      }
      const result = await app.run(
        `--scope-table=${teams}`,
        `--users-table=${users}`,
        `--memberships-table=${memberships}`
      )
      assert.equal(result.exitCode, 0, result.logs.join('\n'))
      const files = await app.migrations()
      assert.deepEqual(files, [
        parents[0][0],
        parents[1][0],
        '3000000000000_access_control_create_memberships.ts',
      ])
      for (const filename of files) {
        if (filename.includes('access_control_create_memberships')) {
          assert.isTrue(await fixture.db.connection().schema.hasTable(users))
          assert.isTrue(await fixture.db.connection().schema.hasTable(teams))
        }
        const module = (await import(pathToFileURL(join(directory, filename)).href)) as {
          default: new (db: unknown, file: string, dryRun: boolean) => BaseSchema
        }
        await new module.default(fixture.db.connection(), filename, false).execUp()
      }
      assert.isTrue(await fixture.db.connection().schema.hasTable(memberships))
      const second = await app.run(
        `--scope-table=${teams}`,
        `--users-table=${users}`,
        `--memberships-table=${memberships}`
      )
      assert.equal(second.exitCode, 0)
      assert.deepEqual(await app.migrations(), files)
    } finally {
      for (const table of [memberships, teams, users])
        await fixture.db.connection().schema.dropTableIfExists(table)
      await fixture.cleanup()
      await app.cleanup()
    }
  })

  test('refuses an existing successor with a missing predecessor before writing anything', async ({
    assert,
  }) => {
    const extended = await mkdtemp(join(tmpdir(), 'access_control_stubs_'))
    const app = await freshApp({ stubs: extended })
    try {
      await cp(stubsRoot, extended, { recursive: true })
      await writeFile(
        join(extended, 'migrations', 'released.json'),
        JSON.stringify([
          { name: 'access_control_create_memberships' },
          { name: 'add_membership_notes' },
        ])
      )
      const directory = join(app.root, 'database/migrations')
      const successor = '2999999999999_add_membership_notes.ts'
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, successor), '// app-owned\n')
      const result = await app.run('--scope-table=teams')
      assert.equal(result.exitCode, 1, result.logs.join('\n'))
      assert.isTrue(
        result.logs.some((message) => message.includes('Do not rename applied migrations'))
      )
      assert.deepEqual(await app.migrations(), [successor])
      assert.equal(await app.read(`database/migrations/${successor}`), '// app-owned\n')
      assert.deepEqual(await readdir(join(app.root, 'config')), ['account_kit.ts'])
      assert.notInclude(await app.read('adonisrc.ts'), 'access_control_provider')
    } finally {
      await app.cleanup()
      await rm(extended, { recursive: true, force: true })
    }
  })

  test('rejects non-conventional numeric prefixes that cannot preserve filename order', ({
    assert,
  }) => {
    assert.throws(
      () => planMigrations(['9999999999999_parent.ts'], ['membership'], 1000000000000),
      /migration history cannot be ordered safely/
    )
    assert.throws(
      () =>
        planMigrations(
          ['2999999999999_next.ts', '3000000000000_previous.ts'],
          ['previous', 'next']
        ),
      /migration history cannot be ordered safely/
    )
  })

  test('each refusal names the blocking file and its cause', ({ assert }) => {
    assert.throws(
      () =>
        planMigrations(['1_membership.ts', 'prior/2_membership.ts'], ['membership'], 1000000000000),
      /1_membership\.ts and prior\/2_membership\.ts both publish the released migration membership.*--migration-path/
    )
    assert.throws(
      () =>
        planMigrations(
          ['2999999999999_next.ts', '3000000000000_previous.ts'],
          ['previous', 'next']
        ),
      /2999999999999_next\.ts sorts before 3000000000000_previous\.ts, which it depends on.*--migration-path/
    )
    assert.throws(
      () => planMigrations(['2999999999999_next.ts'], ['previous', 'next']),
      /2999999999999_next\.ts exists but the released migration previous it depends on does not.*--migration-path/
    )
    assert.throws(
      () => planMigrations(['helpers.ts'], ['membership'], 1000000000000),
      /helpers\.ts sorts after the new 1000000000000_membership\.ts.*--migration-path/
    )
  })

  test('refuses without config/account_kit.ts, without --scope-table, and with invalid values', async ({
    assert,
  }) => {
    const noKit = await freshApp({ accountKit: false })
    try {
      const result = await noKit.run('--scope-table=teams')
      assert.equal(result.exitCode, 1)
      assert.isTrue(result.logs.some((line) => line.includes('config/account_kit.ts is missing')))
      assert.deepEqual(await noKit.migrations(), [])
    } finally {
      await noKit.cleanup()
    }
    const app = await freshApp()
    try {
      const missing = await app.run()
      assert.equal(missing.exitCode, 1)
      assert.isTrue(missing.logs.some((line) => line.includes('--scope-table=<table> is required')))
      const badTable = await app.run('--scope-table=teams;drop')
      assert.equal(badTable.exitCode, 1)
      assert.isTrue(
        badTable.logs.some((line) => line.includes('scopeTable must be a plain SQL identifier'))
      )
      const badType = await app.run('--scope-table=teams', '--scope-id-type=bigint')
      assert.equal(badType.exitCode, 1)
      assert.isTrue(
        badType.logs.some((line) => line.includes('scopeKeyType must be integer, string or uuid'))
      )
      const bareFlag = await app.run('--scope-table=teams', '--memberships-table')
      assert.equal(bareFlag.exitCode, 1)
      assert.isTrue(
        bareFlag.logs.some((line) => line.includes('--memberships-table=<value> needs a value'))
      )
      assert.deepEqual(await readdir(join(app.root, 'config')), ['account_kit.ts'])
      assert.deepEqual(await app.migrations(), [])
      assert.notInclude(await app.read('adonisrc.ts'), 'access_control_provider')
    } finally {
      await app.cleanup()
    }
  })

  test('rejects a generated index name beyond the PostgreSQL limit before writing files', async ({
    assert,
  }) => {
    const app = await freshApp()
    try {
      const rejected = await app.run('--scope-table=teams', `--memberships-table=${'m'.repeat(46)}`)
      assert.equal(rejected.exitCode, 1)
      assert.isTrue(rejected.logs.some((line) => line.includes('at most 45 characters')))
      assert.deepEqual(await readdir(join(app.root, 'config')), ['account_kit.ts'])
      assert.deepEqual(await app.migrations(), [])
      assert.notInclude(await app.read('adonisrc.ts'), 'access_control_provider')
      const accepted = await app.run('--scope-table=teams', `--memberships-table=${'m'.repeat(45)}`)
      assert.equal(accepted.exitCode, 0, accepted.logs.join('\n'))
      assert.lengthOf(await app.migrations(), 1)
    } finally {
      await app.cleanup()
    }
  })

  test('a re-run after a second released stub publishes only the new migration', async ({
    assert,
  }) => {
    const extended = await mkdtemp(join(tmpdir(), 'access_control_stubs_'))
    const app = await freshApp()
    try {
      await cp(stubsRoot, extended, { recursive: true })
      const released = JSON.parse(
        await readFile(join(extended, 'migrations', 'released.json'), 'utf8')
      )
      released.push({ name: 'add_membership_notes', sha256: 'unchecked' })
      await writeFile(join(extended, 'migrations', 'released.json'), JSON.stringify(released))
      await writeFile(
        join(extended, 'migrations', 'add_membership_notes.stub'),
        '{{{ exports({ to: migration.destination }) }}}\nexport default class {}\n'
      )
      const first = await app.run('--scope-table=teams')
      assert.equal(first.exitCode, 0)
      const before = await app.migrations()
      assert.lengthOf(before, 1)

      const later = await freshApp({ stubs: extended })
      await rm(later.root, { recursive: true, force: true })
      await cp(app.root, later.root, { recursive: true, verbatimSymlinks: true })
      const second = await later.run('--scope-table=teams')
      assert.equal(second.exitCode, 0, second.logs.join('\n'))
      const after = await later.migrations()
      assert.lengthOf(after, 2)
      assert.include(after, before[0])
      assert.match(
        after.find((file) => file !== before[0])!,
        /^\d+_add_membership_notes\.ts$/
      )
      await later.cleanup()
    } finally {
      await app.cleanup()
      await rm(extended, { recursive: true, force: true })
    }
  })
})
