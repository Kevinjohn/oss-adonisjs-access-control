import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.js'
import { membershipsMigrationSchema } from './src/migration_schema.js'
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

function flagString(command: Configure, name: string, fallback: string): string {
  const value: unknown = command.parsedFlags[name]
  return value === undefined ? fallback : String(value)
}

/** The Bouncer and Account Kit changes `configure` prints instead of editing application files. */
export const manualSteps = `Bouncer: in app/middleware/initialize_bouncer_middleware.ts merge the generated abilities:
  import accessControl from '${packageName}/services/main'
  ctx.bouncer = new Bouncer(
    () => ctx.auth.user || null,
    { ...abilities, ...accessControl.abilities(() => ctx.membership) },
    policies
  ).setContainerResolver(ctx.containerResolver)
  and widen the HttpContext bouncer type with ReturnType<typeof accessControl.abilities>.
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
export async function configureWith(command: Configure, root: string): Promise<void> {
  const scopeTable: unknown = command.parsedFlags['scope-table']
  if (scopeTable === undefined || scopeTable === true) {
    command.logger.error(
      'access-control: --scope-table=<table> is required (the table your scope rows live in)'
    )
    command.exitCode = 1
    return
  }
  if (!existsSync(command.app.makePath('config/account_kit.ts'))) {
    command.logger.error(
      'access-control: config/account_kit.ts is missing; configure @kevinjohn/adonisjs-account-kit first'
    )
    command.exitCode = 1
    return
  }
  const usersTable = flagString(command, 'users-table', 'users')
  const membershipsTable = flagString(command, 'memberships-table', 'memberships')
  const userKeyType = flagString(command, 'user-id-type', 'integer') as KeyType
  const scopeKeyType = flagString(command, 'scope-id-type', 'integer') as KeyType
  let schema: ReturnType<typeof membershipsMigrationSchema>
  try {
    schema = membershipsMigrationSchema({
      membershipsTable,
      usersTable,
      userKeyType,
      scopeTable: String(scopeTable),
      scopeKeyType,
    })
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
    scopeTable: String(scopeTable),
    scopeKeyType,
    membershipsTable,
  })

  let migrationFiles: string[] = []
  try {
    migrationFiles = await readdir(command.app.makePath('database/migrations'))
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  const timestamp = Date.now()
  const released = await releasedMigrations(root)
  for (const [index, name] of released.entries()) {
    const suffix = `_${name}.ts`
    if (migrationFiles.some((filename) => filename.endsWith(suffix))) {
      command.logger.info(`Skipped database/migrations/*${suffix}`)
      continue
    }
    await codemods.makeUsingStub(root, `migrations/${name}.stub`, {
      ...schema,
      migration: {
        destination: command.app.makePath(`database/migrations/${timestamp + index}${suffix}`),
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
