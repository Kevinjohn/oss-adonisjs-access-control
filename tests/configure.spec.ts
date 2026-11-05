// Specification section 11: `node ace configure` on a fresh application with Account Kit.
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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

async function freshApp(options: { accountKit?: boolean; stubs?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'access_control_configure_'))
  await writeFile(
    join(root, 'package.json'),
    '{"type":"module","devDependencies":{"@adonisjs/assembler":"8.6.0"}}'
  )
  await writeFile(join(root, 'tsconfig.json'), '{}')
  await writeFile(
    join(root, 'adonisrc.ts'),
    "import { defineConfig } from '@adonisjs/core/app'\nexport default defineConfig({ commands: [], providers: [] })\n"
  )
  await mkdir(join(root, 'start'))
  await writeFile(join(root, 'start', 'kernel.ts'), kernelSource)
  await mkdir(join(root, 'config'))
  if (options.accountKit !== false)
    await writeFile(join(root, 'config', 'account_kit.ts'), 'export default {}\n')
  await symlink(
    fileURLToPath(new URL('../node_modules', import.meta.url)),
    join(root, 'node_modules')
  )
  const stubs = options.stubs ?? stubsRoot
  const importer = (specifier: string) =>
    specifier === packageName
      ? Promise.resolve({ configure: (command: Configure) => configureWith(command, stubs) })
      : import(specifier)
  const ignitor = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({
      rcFileContents: { providers: [], commands: [async () => new ListLoader([Configure])] },
    })
    .create(pathToFileURL(`${root}/`), { importer })
  const read = (path: string) => readFile(join(root, path), 'utf8')
  const migrations = async () => {
    try {
      const files = await readdir(join(root, 'database', 'migrations'))
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
      assert.match(files[0], /^\d+_create_memberships\.ts$/)
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
          line.includes('Skipped database/migrations/*_create_memberships.ts')
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
      assert.deepEqual(await app.migrations(), [])
      assert.notInclude(await app.read('adonisrc.ts'), 'access_control_provider')
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
