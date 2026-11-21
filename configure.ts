import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.js'
import { membershipsMigrationSchema } from './src/migration_schema.js'
import { planMigrations } from './src/migration_order.js'
import type { KeyType } from './src/types.js'

const packageName = '@kevinjohn/adonisjs-access-control'

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/** The released migration stubs, in publishing order, from `migrations/released.json`. */
export async function releasedMigrations(root: string): Promise<string[]> {
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

/** The Bouncer and Account Kit changes `configure` prints instead of editing application files. */
export const manualSteps = `Bouncer: in app/middleware/initialize_bouncer_middleware.ts merge the generated abilities:
  import accessControl from '#config/access_control'
  ctx.bouncer = new Bouncer(
    () => ctx.auth.user || null,
    { ...abilities, ...accessControl.abilities(() => ctx.membership) },
    policies
  ).setContainerResolver(ctx.containerResolver)
  and widen the HttpContext bouncer type with ReturnType<typeof accessControl.abilities>.
  (config/access_control.ts carries the permission-key types; services/main is typed as a bare AccessControl.)
Routes: apply Account Kit's managedAccountMiddleware or admissionMiddleware before middleware.scope().
Account Kit: in config/account_kit.ts pass the package callbacks:
  import { accessControlKitCallbacks } from '${packageName}/account-kit'
  const kitCallbacks = accessControlKitCallbacks()
  authorize: kitCallbacks.authorize,
  onInvitationAccepted: kitCallbacks.onInvitationAccepted,
  onAccountDeletingTransaction: kitCallbacks.onAccountDeletingTransaction,
  exportAccountData: kitCallbacks.exportAccountData,
Then run node ace migration:run and node ace access-control:doctor.`

/**
 * The configure steps against a given stub directory: config file, released migrations,
 * provider, command and named middleware. Existing files are skipped, never rewritten.
 */
export async function configureWith(
  command: Configure,
  root: string,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
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
  let schema: ReturnType<typeof membershipsMigrationSchema>
  try {
    schema = membershipsMigrationSchema({
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
  let migrationFiles: string[] = []
  try {
    migrationFiles = await readdir(destination)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  let plan: ReturnType<typeof planMigrations>
  try {
    plan = planMigrations(migrationFiles, await releasedMigrations(root))
  } catch (error) {
    command.logger.error((error as Error).message)
    command.exitCode = 1
    return
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
  command.logger.info(manualSteps)
}

/**
 * Runs on `node ace configure @kevinjohn/adonisjs-access-control --scope-table=<table>`
 * (`--scope-id-type`, `--users-table`, `--user-id-type` and `--memberships-table` are optional):
 * writes `config/access_control.ts`, publishes the released migrations, registers the provider,
 * the commands and the named `scope` middleware, and prints the Bouncer and Account Kit changes.
 */
export async function configure(command: Configure): Promise<void> {
  await configureWith(command, stubsRoot)
}
