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
const artifact = consumerArtifact(root, args.get('package'))
const digest = createHash('sha256')
  .update(await readFile(artifact))
  .digest('hex')
const directory = join(
  root,
  'tmp',
  'consumers',
  `${digest.slice(0, 12)}_${randomUUID().slice(0, 8)}`
)
await mkdir(directory, { recursive: true })
const processRunner = new ConsumerProcessRunner(directory)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => processRunner.interrupt(signal))
}
const floor = {
  '@adonisjs/core': '7.0.0',
  '@adonisjs/auth': '10.0.0',
  '@adonisjs/bouncer': '4.0.0',
  '@adonisjs/lucid': '22.4.2',
  'luxon': '3.4.4',
  'typescript': '5.9.3',
}
const packedManifest = JSON.parse(
  execFileSync('tar', ['-xOf', artifact, 'package/package.json'], { encoding: 'utf8' })
)
const ranges: Record<string, string> = packedManifest.peerDependencies
for (const [name, version] of Object.entries(floor)) {
  const declaredFloor = ranges[name]?.match(/\d+\.\d+\.\d+/)?.[0]
  if (declaredFloor !== version)
    throw new Error(`Floor selection mismatch for ${name}: ${version} vs declared ${declaredFloor}`)
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
  assert.equal(typeof api.stubsRoot, 'string')
  await access(join(api.stubsRoot, 'main.js'))
  await access(join(api.stubsRoot, 'migrations', 'released.json'))
  const commands = await import('@kevinjohn/adonisjs-access-control/commands')
  const metadata = await commands.getMetaData()
  assert.deepEqual(metadata.map((c) => c.commandName), ['access-control:doctor'])
  for (const subpath of ['types', 'services/main', 'middleware', 'account-kit'])
    assert.equal(typeof (await import('@kevinjohn/adonisjs-access-control/' + subpath)), 'object')
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

try {
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
      filter: (source) =>
        !relative(join(root, 'examples/consumer'), source)
          .split('/')
          .some((part) => ['node_modules', 'build', 'tmp', '.git', '.adonisjs'].includes(part)),
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
    const installation = await run(app, ['install', '--no-frozen-lockfile'], `${selected}_install`)
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
    await run(app, ['lint'], `${selected}_lint`)
    await run(app, ['build'], `${selected}_build`)
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
        engine === 'pg' ? { ...pgEnv, DB_SCHEMA: schemaName } : { ...baseEnv, DB_CLIENT: 'sqlite' }
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
} catch (error) {
  let failure: unknown = error
  if (ownsPostgres) {
    try {
      await run(root, ['pg:stop'], 'postgres_stop', baseEnv, true)
    } catch (cleanupError) {
      failure = combineFailures(failure, cleanupError)
    }
  }
  console.error(`[consumer] FAILED: ${describeFailure(failure)}`)
  process.exitCode =
    processRunner.interruptedBy === 'SIGINT'
      ? 130
      : processRunner.interruptedBy === 'SIGTERM'
        ? 143
        : 1
}
if (process.exitCode === undefined) {
  if (ownsPostgres) {
    try {
      await run(root, ['pg:stop'], 'postgres_stop', baseEnv, true)
    } catch (error) {
      console.error(`[consumer] cleanup failed: ${describeFailure(error)}`)
      process.exitCode =
        processRunner.interruptedBy === 'SIGINT'
          ? 130
          : processRunner.interruptedBy === 'SIGTERM'
            ? 143
            : 1
    }
  }
}
if (process.exitCode === undefined) {
  console.log(
    `[consumer] Complete: ${args.has('scaffold-only') ? directory : join(directory, 'results.json')}`
  )
  if (processRunner.interruptedBy === 'SIGINT') process.exitCode = 130
  else if (processRunner.interruptedBy === 'SIGTERM') process.exitCode = 143
}

async function writeResults(): Promise<void> {
  await writeFile(
    join(directory, 'results.json'),
    JSON.stringify(
      {
        artifact: basename(artifact),
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
