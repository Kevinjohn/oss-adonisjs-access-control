import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { consumerArtifact } from './helpers/consumer_artifact.js'
import { ConsumerCommandError, ConsumerProcessRunner } from './helpers/consumer_process.js'
import { selectRegistryVersion } from './helpers/registry_version.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...values] = arg.replace(/^--/, '').split('=')
    return [key, values.join('=')]
  })
)
const profile = args.get('profile') ?? 'all'
const database = args.get('database') ?? 'all'
if (!['all', 'floor', 'latest'].includes(profile) || !['all', 'sqlite', 'pg'].includes(database))
  throw new Error('Use --profile=floor|latest|all --database=sqlite|pg|all')
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24')
const directory = join(root, 'tmp', 'consumers', `run_${randomUUID()}`)
await mkdir(directory, { recursive: true })
const processRunner = new ConsumerProcessRunner(directory)
const onInt = () => {
  processRunner.interrupt('SIGINT')
  process.exitCode = processRunner.interruptedBy === 'SIGINT' ? 130 : 143
}
const onTerm = () => {
  processRunner.interrupt('SIGTERM')
  process.exitCode = processRunner.interruptedBy === 'SIGINT' ? 130 : 143
}
process.on('SIGINT', onInt)
process.on('SIGTERM', onTerm)
const floor = {
  '@adonisjs/core': '7.0.0',
  '@adonisjs/auth': '10.0.0',
  '@adonisjs/bouncer': '4.0.0',
  '@adonisjs/lucid': '22.4.2',
  'luxon': '3.4.4',
  'typescript': '5.9.3',
}
let snapshot: Awaited<ReturnType<typeof consumerArtifact>> | undefined
let artifact = ''
let digest = ''
let ranges: Record<string, string> = {}
let failure: unknown
try {
  snapshot = await consumerArtifact(root, args.get('package'), processRunner)
  artifact = snapshot.path
  digest = createHash('sha256')
    .update(await readFile(artifact))
    .digest('hex')
  const packedManifest = JSON.parse(
    execFileSync('tar', ['-xOf', artifact, 'package/package.json'], { encoding: 'utf8' })
  )
  ranges = packedManifest.peerDependencies
  for (const [name, version] of Object.entries(floor)) {
    const declaredFloor = ranges[name]?.match(/\d+\.\d+\.\d+/)?.[0]
    if (declaredFloor !== version)
      throw new Error(
        `Floor selection mismatch for ${name}: ${version} vs declared ${declaredFloor}`
      )
  }
  if (processRunner.interruptedBy) throw new Error(`Interrupted by ${processRunner.interruptedBy}`)
} catch (error) {
  failure = error
}
const results: Array<Record<string, unknown>> = []
let ownsPostgres = false
const baseEnv = {
  ...process.env,
  NODE_ENV: 'test',
  TZ: 'UTC',
  HOST: '127.0.0.1',
  PORT: '3333',
  APP_URL: 'http://127.0.0.1:3333',
  APP_KEY: 'consumer_fixture_key_01234567890123456789',
  LOG_LEVEL: 'error',
  SESSION_DRIVER: 'memory',
  FORCE_COLOR: '0',
  NO_COLOR: '1',
}

const rootProbe = `
  import assert from 'node:assert/strict'
  import { access } from 'node:fs/promises'
  import { join } from 'node:path'
  const api = await import('@kevinjohn/adonisjs-access-control')
  assert.equal(typeof api.configure, 'function')
  assert.equal(api.defineConfig, api.defineAccessControl)
  assert.equal(typeof api.stubsRoot, 'string')
  await access(join(api.stubsRoot, 'main.js'))
  await access(join(api.stubsRoot, 'migrations', 'released.json'))
  const commands = await import('@kevinjohn/adonisjs-access-control/commands')
  const metadata = await commands.getMetaData()
  assert.deepEqual(metadata.map((c) => c.commandName), ['access-control:doctor'])
  for (const subpath of ['types', 'middleware', 'scope_middleware', 'account-kit'])
    assert.equal(typeof (await import('@kevinjohn/adonisjs-access-control/' + subpath)), 'object')
  const middleware = await import('@kevinjohn/adonisjs-access-control/middleware')
  const scopeMiddleware = await import('@kevinjohn/adonisjs-access-control/scope_middleware')
  assert.equal(middleware.default, scopeMiddleware.default)
  assert.equal(middleware.scopeMiddleware, scopeMiddleware.scopeMiddleware)
  await assert.rejects(import('@kevinjohn/adonisjs-access-control/services/main'), /requires an AdonisJS application/)
  assert.equal(new api.errors.E_ACCESS_CONTROL_FORBIDDEN().code, 'E_ACCESS_CONTROL_FORBIDDEN')
`

const providerProbe = `
  import assert from 'node:assert/strict'
  const provider = await import('@kevinjohn/adonisjs-access-control/access_control_provider')
  assert.equal(typeof provider.default, 'function')
  await assert.rejects(
    import('@kevinjohn/adonisjs-access-control/providers/access_control_provider'),
    { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }
  )
`

const runtimeWithoutAssemblerProbe = `
  import assert from 'node:assert/strict'
  import { createRequire } from 'node:module'
  const entry = import.meta.resolve('@kevinjohn/adonisjs-access-control')
  const requireFromPackage = createRequire(entry)
  assert.throws(() => requireFromPackage.resolve('@adonisjs/assembler'), { code: 'MODULE_NOT_FOUND' })
  const api = await import(entry)
  const config = api.defineConfig({
    roles: ['viewer'],
    users: { table: 'users', keyType: 'integer' },
    scope: { table: 'teams', keyType: 'integer' },
    permissions: { members: { list: 'viewer', manage: 'viewer' }, invitations: { manage: 'viewer' } },
  })
  assert.equal(config.can('viewer', 'members:list'), true)
`

const pgEnv = {
  ...baseEnv,
  DB_CLIENT: 'pg',
  DB_HOST: process.env.DB_HOST ?? '127.0.0.1',
  DB_PORT: process.env.DB_PORT ?? '55432',
  DB_USER: process.env.DB_USER ?? 'account_kit',
  DB_PASSWORD: process.env.DB_PASSWORD ?? '',
  DB_DATABASE: process.env.DB_DATABASE ?? 'package_test',
}

const run = (
  cwd: string,
  command: string[],
  name: string,
  env: NodeJS.ProcessEnv = baseEnv,
  cleanup = false
) => processRunner.run(cwd, command, name, env, cleanup)

async function schema(cwd: string, name: string, action: 'create' | 'drop') {
  const sql =
    action === 'create' ? `create schema ${name}` : `drop schema if exists ${name} cascade`
  await run(
    cwd,
    [
      'exec',
      'node',
      '--input-type=module',
      '--eval',
      `import pg from 'pg'; const client=new pg.Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_DATABASE}); await client.connect(); try {await client.query(${JSON.stringify(sql)})} finally {await client.end()}`,
    ],
    `${name}_${action}`,
    pgEnv,
    action === 'drop'
  )
}

/** Stable filename/content snapshot, independent of the directory enumeration order. */
async function migrationSnapshot(migrationDirectory: string): Promise<Record<string, string>> {
  const files = await readdir(migrationDirectory)
  return Object.fromEntries(
    await Promise.all(
      files.sort().map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(join(migrationDirectory, file)))
          .digest('hex'),
      ])
    )
  )
}

try {
  if (failure === undefined) {
    for (const selected of profile === 'all' ? ['floor', 'latest'] : [profile]) {
      const versions: Record<string, string> = { ...floor }
      if (selected === 'latest')
        for (const name of Object.keys(floor)) {
          const listed: unknown = JSON.parse(
            await run(
              root,
              ['view', `${name}@${ranges[name]}`, 'version', '--json'],
              `latest_${name.replaceAll('/', '_')}`
            )
          )
          versions[name] = selectRegistryVersion(name, listed)
        }
      const app = await mkdtemp(join(tmpdir(), `access_control_consumer_${selected}_`))
      console.log(`[consumer] isolated ${selected} app: ${app}`)
      await cp(join(root, 'examples/consumer'), app, {
        recursive: true,
        filter: (source) => {
          const path = relative(join(root, 'examples/consumer'), source)
          // The checked-in functional fixture has a hand-written membership migration, not
          // the package's released stable suffix. On a fresh disposable full consumer, omit
          // that one file so configure publishes the actual packed migration. Keep the tracked
          // fixture and any existing migration history untouched.
          if (
            !args.has('scaffold-only') &&
            path === 'database/migrations/1793900000000_create_memberships.ts'
          )
            return false
          return !path
            .split('/')
            .some((part) => ['node_modules', 'build', 'tmp', '.git', '.adonisjs'].includes(part))
        },
      })
      await mkdir(join(app, 'tmp'), { recursive: true })
      const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
      for (const [name, version] of Object.entries(versions)) {
        const section = name === 'typescript' ? 'devDependencies' : 'dependencies'
        manifest[section][name] = version
      }
      manifest.dependencies['@kevinjohn/adonisjs-access-control'] = 'file:./package.tgz'
      await writeFile(
        join(app, 'pnpm-workspace.yaml'),
        JSON.stringify({ overrides: versions, allowBuilds: manifest.allowScripts }, null, 2) + '\n'
      )
      await cp(artifact, join(app, 'package.tgz'))
      await writeFile(join(app, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
      const installation = await run(
        app,
        ['install', '--no-frozen-lockfile'],
        `${selected}_install`
      )
      if (/unmet peer|issues with peer dependencies|ERR_PNPM_PEER_DEP/i.test(installation))
        throw new Error('Consumer installation reports incompatible peer requirements')
      const storeEntries = await readdir(join(app, 'node_modules/.pnpm'))
      const semverEntry = storeEntries.find((entry) => entry.startsWith('semver@'))
      if (!semverEntry)
        throw new Error('Peer validation requires the installed tooling semver module')
      const requireTool = createRequire(join(app, 'package.json'))
      const semver = requireTool(
        join(app, 'node_modules/.pnpm', semverEntry, 'node_modules/semver')
      ) as { satisfies(version: string, range: string): boolean }
      const tooling: Record<string, string> = {}
      const dependencies: Record<string, string> = {}
      const installedPackages: Record<
        string,
        { version: string; peerDependencies?: Record<string, string> }
      > = {}
      for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
        installedPackages[name] = JSON.parse(
          await readFile(join(app, 'node_modules', name, 'package.json'), 'utf8')
        )
        if (name in manifest.devDependencies) tooling[name] = installedPackages[name].version
        else dependencies[name] = installedPackages[name].version
      }
      let peerChecks = 0
      for (const [name, info] of Object.entries(installedPackages))
        for (const [peer, range] of Object.entries(info.peerDependencies ?? {})) {
          const installed = installedPackages[peer]
          if (!installed) continue
          peerChecks++
          if (!semver.satisfies(installed.version, range))
            throw new Error(
              `${name}@${info.version} requires peer ${peer}@${range}, installed ${installed.version}`
            )
        }

      const resolved: Record<string, string> = {}
      for (const [name, version] of Object.entries(versions)) {
        const installed = JSON.parse(
          await readFile(join(app, 'node_modules', name, 'package.json'), 'utf8')
        )
        resolved[name] = installed.version
        if (installed.version !== version)
          throw new Error(`${selected}: ${name} resolved ${installed.version}, expected ${version}`)
      }
      await run(
        app,
        ['exec', 'node', '--input-type=module', '--eval', rootProbe],
        `${selected}_root_exports`
      )
      await run(
        app,
        ['exec', 'node', '--input-type=module', '--eval', providerProbe],
        `${selected}_provider_exports`
      )
      if (args.has('scaffold-only')) {
        await writeFile(
          join(directory, `${selected}_scaffold.json`),
          JSON.stringify(
            { packageSha256: digest, profile: selected, versions: resolved, tooling, peerChecks },
            null,
            2
          ) + '\n'
        )
        console.log(`[consumer] PASS ${selected} packed scaffold`)
        await rm(app, { recursive: true, force: true })
        continue
      }
      const migrationDirectory = join(app, 'database/migrations')
      const beforeMigrations = await migrationSnapshot(migrationDirectory)
      const beforeConfig = await readFile(join(app, 'config/access_control.ts'), 'utf8')
      const configure = (stage: string) =>
        run(
          app,
          [
            'exec',
            'node',
            'ace',
            'configure',
            '@kevinjohn/adonisjs-access-control',
            '--scope-table=teams',
          ],
          `${selected}_configure_${stage}`,
          { ...baseEnv, DB_CLIENT: 'sqlite' }
        )
      await configure('initial')
      const generated = await migrationSnapshot(migrationDirectory)
      const added = Object.keys(generated).filter((filename) => !(filename in beforeMigrations))
      if (
        added.length !== 1 ||
        !/^\d+_access_control_create_memberships\.ts$/.test(added[0]) ||
        Object.keys(beforeMigrations).some((filename) => filename >= added[0])
      )
        throw new Error(
          'Packed configure must publish exactly one membership migration after its parents'
        )
      if (
        Object.entries(beforeMigrations).some(([filename, hash]) => generated[filename] !== hash) ||
        (await readFile(join(app, 'config/access_control.ts'), 'utf8')) !== beforeConfig
      )
        throw new Error(
          'Packed configure must preserve existing configuration and parent migrations'
        )

      await configure('repeat')
      if (
        JSON.stringify(await migrationSnapshot(migrationDirectory)) !== JSON.stringify(generated) ||
        (await readFile(join(app, 'config/access_control.ts'), 'utf8')) !== beforeConfig
      )
        throw new Error(
          'Packed configure rerun must leave existing configuration and migrations unchanged'
        )
      // The immutable released stub predates the consumer's current format rules. Run the
      // host's formatter on only the new disposable migration, after byte-preservation checks.
      await run(
        app,
        ['exec', 'prettier', '--write', join('database/migrations', added[0])],
        `${selected}_format_generated_migration`
      )
      await run(app, ['lint'], `${selected}_lint`)
      await run(app, ['build'], `${selected}_build`)
      // Resolve a new production-only graph rather than reusing dev peer links. Check it
      // before recording any database pass, so results include the runtime prerequisite.
      const runtime = await mkdtemp(join(tmpdir(), `access_control_runtime_${selected}_`))
      try {
        await cp(artifact, join(runtime, 'package.tgz'))
        await cp(join(app, 'pnpm-workspace.yaml'), join(runtime, 'pnpm-workspace.yaml'))
        await writeFile(
          join(runtime, 'package.json'),
          JSON.stringify({
            name: 'access-control-runtime-probe',
            private: true,
            type: 'module',
            dependencies: manifest.dependencies,
          })
        )
        await run(
          runtime,
          ['install', '--prod', '--no-frozen-lockfile'],
          `${selected}_runtime_install`
        )
        await run(
          runtime,
          ['exec', 'node', '--input-type=module', '--eval', runtimeWithoutAssemblerProbe],
          `${selected}_runtime_without_assembler`
        )
      } finally {
        await rm(runtime, { recursive: true, force: true })
      }
      for (const engine of database === 'all' ? ['sqlite', 'pg'] : [database]) {
        const schemaName = `consumer_${selected}_${randomUUID().replaceAll('-', '')}`
        if (engine === 'pg' && !ownsPostgres && process.env.CONSUMER_PG_EXTERNAL !== '1') {
          try {
            const output = await run(root, ['pg:start'], 'postgres_start')
            ownsPostgres = !output.includes('already running')
          } catch (error) {
            if (
              error instanceof ConsumerCommandError &&
              error.commandName === 'postgres_start' &&
              /server started/i.test(error.output) &&
              !/already running/i.test(error.output)
            ) {
              ownsPostgres = true
            }
            throw error
          }
        }
        const env =
          engine === 'pg'
            ? { ...pgEnv, DB_SCHEMA: schemaName }
            : { ...baseEnv, DB_CLIENT: 'sqlite' }
        let engineFailure: unknown
        try {
          if (engine === 'pg') await schema(app, schemaName, 'create')
          await run(app, ['typecheck'], `${selected}_${engine}_typecheck`, env)
          const functional = await run(app, ['test'], `${selected}_${engine}_functional`, env)
          const match = functional.match(/(\d+)\s+passed/)
          if (!match) throw new Error('Missing consumer test pass count')
          results.push({
            profile: selected,
            database: engine,
            peerRanges: ranges,
            versions: resolved,
            tooling,
            dependencies,
            peerChecks,
            functional: Number(match[1]),
            fixtureLint: 'passed',
            fixtureBuild: 'passed',
            runtimeWithoutAssembler: 'passed',
            packageSha256: digest,
          })
          await writeResults()
          console.log(`[consumer] PASS ${selected}/${engine}`)
        } catch (error) {
          engineFailure = error
        } finally {
          if (engine === 'pg') {
            try {
              await schema(app, schemaName, 'drop')
            } catch (error) {
              engineFailure = combineFailures(engineFailure, error)
            }
          }
        }
        if (engineFailure !== undefined) throw engineFailure
      }
      // The resolved graph outlives the app: its lockfile, the lockfile digest and the full list.
      const lockfile = `${selected}_consumer-pnpm-lock.yaml`
      const dependencyGraph = `${selected}_consumer-dependency-graph.json`
      await cp(join(app, 'pnpm-lock.yaml'), join(directory, lockfile))
      const lockfileSha256 = createHash('sha256')
        .update(await readFile(join(directory, lockfile)))
        .digest('hex')
      const graph: unknown = JSON.parse(
        await run(app, ['list', '--depth', 'Infinity', '--json'], `${selected}_dependency_graph`)
      )
      await writeFile(join(directory, dependencyGraph), JSON.stringify(graph, null, 2) + '\n')
      for (const entry of results)
        if (entry.profile === selected) Object.assign(entry, { lockfileSha256, dependencyGraph })
      await writeResults()
      // A passing app is removed; a failing one stays for inspection next to its logs.
      await rm(app, { recursive: true, force: true })
    }
  }
} catch (error) {
  failure = error
}
if (ownsPostgres) {
  try {
    await run(root, ['pg:stop'], 'postgres_stop', baseEnv, true)
  } catch (cleanupError) {
    failure = combineFailures(failure, cleanupError)
  }
}
if (snapshot) {
  try {
    snapshot.cleanup()
  } catch (cleanupError) {
    failure = combineFailures(failure, cleanupError)
  }
}
if (processRunner.interruptedBy && failure === undefined)
  failure = new Error(`Interrupted by ${processRunner.interruptedBy}`)
if (failure !== undefined) {
  console.error(`[consumer] FAILED: ${describeFailure(failure)}`)
  process.exitCode =
    processRunner.interruptedBy === 'SIGINT'
      ? 130
      : processRunner.interruptedBy === 'SIGTERM'
        ? 143
        : 1
} else {
  console.log(
    `[consumer] Complete: ${args.has('scaffold-only') ? directory : join(directory, 'results.json')}`
  )
}

async function writeResults(): Promise<void> {
  await writeFile(
    join(directory, 'results.json'),
    JSON.stringify(
      {
        artifact: args.get('package') ? basename(args.get('package')!) : 'package.tgz',
        packageSha256: digest,
        nodeVersion: process.version,
        results,
      },
      null,
      2
    ) + '\n'
  )
}

function combineFailures(primary: unknown, cleanup: unknown): AggregateError {
  return new AggregateError(
    primary === undefined ? [cleanup] : [primary, cleanup],
    'The consumer operation and cleanup both failed.'
  )
}

function describeFailure(error: unknown): string {
  if (error instanceof AggregateError) {
    return [error.message, ...[...error.errors].map(describeFailure)].join('\n')
  }
  return error instanceof Error ? error.message : String(error)
}
