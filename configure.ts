import { lstat, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sourceFiles } from '@adonisjs/lucid/utils'
import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.js'
import { buildMembershipMigrationSchema } from './src/migration_schema.js'
import { planMigrations } from './src/migration_order.js'
import type { KeyType } from './src/types.js'

const packageName = '@kevinjohn/adonisjs-access-control'

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/** The released migration stubs, in publishing order, from `migrations/released.json`. */
export async function readReleasedMigrationNames(root: string): Promise<string[]> {
  const released = JSON.parse(
    await readFile(join(root, 'migrations', 'released.json'), 'utf8')
  ) as Array<{ name: string }>
  return released.map((entry) => entry.name)
}

/** The flag's value, `fallback` when absent, or `undefined` after reporting a value-less flag. */
function flagString(command: Configure, name: string, fallback: string): string | undefined {
  const value: unknown = command.parsedFlags[name]
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value === '') {
    command.logger.error(`access-control: --${name}=<value> needs a value`)
    command.exitCode = 1
    return undefined
  }
  return value
}

/** The Bouncer and Account Kit changes `configure` prints instead of editing application files,
 * with the application's own config and middleware paths. */
export function formatManualSteps(app: Configure['app']): string {
  const resolveConfigPath = (name: string) => app.relativePath(app.configPath(name))
  const bouncerMiddleware = app.relativePath(app.middlewarePath('initialize_bouncer_middleware.ts'))
  return `Bouncer: in ${bouncerMiddleware} merge the generated abilities:
  import accessControl from '#config/access_control' (the import alias of ${resolveConfigPath('access_control.ts')})
  ctx.bouncer = new Bouncer(
    () => ctx.auth.user || null,
    { ...abilities, ...accessControl.abilities(() => ctx.membership) },
    policies
  ).setContainerResolver(ctx.containerResolver)
  and widen the HttpContext bouncer type with ReturnType<typeof accessControl.abilities>.
  (${resolveConfigPath('access_control.ts')} carries the permission-key types; services/main is typed as a bare AccessControl.)
Routes: apply Account Kit's managedAccountMiddleware or admissionMiddleware before middleware.scope().
Account Kit: in ${resolveConfigPath('account_kit.ts')} pass the package callbacks:
  import { accessControlKitCallbacks } from '${packageName}/account-kit'
  const kitCallbacks = accessControlKitCallbacks()
  authorize: kitCallbacks.authorize,
  onInvitationAccepted: kitCallbacks.onInvitationAccepted,
  onAccountDeletingTransaction: kitCallbacks.onAccountDeletingTransaction,
  exportAccountData: kitCallbacks.exportAccountData,
Then run node ace migration:run and node ace access-control:doctor.`
}

/** Options of `configureWith`. */
export interface ConfigureOptions {
  /** Whether to prompt for a missing `--scope-table`; defaults to whether stdin and stdout are TTYs. */
  interactive?: boolean
}

/**
 * The configure steps against a given stub directory: config file, released migrations,
 * provider, command and named middleware. Existing files are skipped, never rewritten.
 */
export async function configureWith(
  command: Configure,
  root: string,
  { interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) }: ConfigureOptions = {}
): Promise<void> {
  const accountKitPath = command.app.configPath('account_kit.ts')
  if (!existsSync(accountKitPath)) {
    command.logger.error(
      `access-control: ${command.app.relativePath(accountKitPath)} is missing; configure @kevinjohn/adonisjs-account-kit first`
    )
    command.exitCode = 1
    return
  }
  if (command.parsedFlags['scope-table'] === undefined && !interactive) {
    command.logger.error(
      'access-control: --scope-table=<table> is required (the table your scope rows live in)'
    )
    command.exitCode = 1
    return
  }
  const scopeTable =
    command.parsedFlags['scope-table'] === undefined
      ? await command.prompt.ask('Which table holds the scope rows?', { name: 'scope-table' })
      : flagString(command, 'scope-table', '')
  const usersTable = flagString(command, 'users-table', 'users')
  const membershipsTable = flagString(command, 'memberships-table', 'memberships')
  const userKeyType = flagString(command, 'user-id-type', 'integer') as KeyType | undefined
  const scopeKeyType = flagString(command, 'scope-id-type', 'integer') as KeyType | undefined
  const migrationPath = flagString(
    command,
    'migration-path',
    command.app.relativePath(command.app.migrationsPath())
  )
  if (
    scopeTable === undefined ||
    usersTable === undefined ||
    membershipsTable === undefined ||
    userKeyType === undefined ||
    scopeKeyType === undefined ||
    migrationPath === undefined
  )
    return
  let schema: ReturnType<typeof buildMembershipMigrationSchema>
  try {
    schema = buildMembershipMigrationSchema({
      membershipsTable,
      usersTable,
      userKeyType,
      scopeTable,
      scopeKeyType,
    })
  } catch (error) {
    command.logger.error((error as Error).message)
    command.exitCode = 1
    return
  }

  const destination = command.app.makePath(migrationPath)
  const info = await stat(destination).catch((error: unknown) => {
    if (!isMissing(error)) throw error
  })
  if (info && !info.isDirectory()) {
    command.logger.error(
      `access-control: the migration path ${migrationPath} is not a directory; pass --migration-path=<directory> relative to the application root`
    )
    command.exitCode = 1
    return
  }
  const { files } = await sourceFiles(pathToFileURL(destination + sep), '.', false)
  const migrationFiles = files.map((file) => relative(destination, file.absPath))
  let plan: ReturnType<typeof planMigrations>
  try {
    plan = planMigrations(migrationFiles, await readReleasedMigrationNames(root))
  } catch (error) {
    command.logger.error((error as Error).message)
    command.exitCode = 1
    return
  }
  for (const { existing, filename } of plan) {
    if (existing) continue
    const path = join(destination, filename)
    const entry = await lstat(path).catch((error: unknown) => {
      if (!isMissing(error)) throw error
    })
    if (entry) {
      command.logger.error(
        `access-control: move ${path} out of the migration destination and rerun configure`
      )
      command.exitCode = 1
      return
    }
  }

  const codemods = await command.createCodemods()
  codemods.overwriteExisting = false

  await codemods.makeUsingStub(root, 'config.stub', {
    usersTable,
    userKeyType,
    scopeTable,
    scopeKeyType,
    membershipsTable,
  })

  for (const { name, filename, existing } of plan) {
    if (existing) {
      command.logger.info(`Skipped ${migrationPath}/*_${name}.ts`)
      continue
    }
    await codemods.makeUsingStub(root, `migrations/${name}.stub`, {
      ...schema,
      migration: {
        destination: join(destination, filename),
      },
    })
  }

  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider(`${packageName}/access_control_provider`)
    rcFile.addCommand(`${packageName}/commands`)
  })
  await codemods.registerMiddleware('named', [{ name: 'scope', path: `${packageName}/middleware` }])
  command.logger.info(formatManualSteps(command.app))
}

/**
 * Runs on `node ace configure @kevinjohn/adonisjs-access-control`. Flags:
 * - `--scope-table=<table>`: the table the scope rows live in. Required without a terminal; in an
 *   interactive terminal configure prompts for it when the flag is absent.
 * - `--scope-id-type=<integer|string|uuid>` (default `integer`)
 * - `--users-table=<table>` (default `users`)
 * - `--user-id-type=<integer|string|uuid>` (default `integer`)
 * - `--memberships-table=<table>` (default `memberships`)
 * - `--migration-path=<directory>`: relative to the application root; defaults to the
 *   application's migrations directory.
 *
 * Requires the application's `account_kit.ts` config. Writes `access_control.ts` in the
 * application's config directory, publishes the released migrations not yet present, registers
 * the provider, the commands and the named `scope` middleware, and prints the Bouncer and Account
 * Kit changes. Existing files are skipped, never rewritten. Sets exit code 1 and writes nothing
 * when a flag is invalid or the migration order cannot be kept.
 */
export async function configure(command: Configure): Promise<void> {
  await configureWith(command, stubsRoot)
}
