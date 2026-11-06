import type Configure from '@adonisjs/core/commands/configure'

/**
 * `node ace configure @kevinjohn/adonisjs-access-control`. The scaffold milestone registers
 * the hook; the setup steps (config, migration, provider and middleware) arrive with the
 * configure milestone.
 */
export async function configure(command: Configure): Promise<void> {
  command.logger.error(
    'access-control: the configure command is not available in this version of the package'
  )
  command.exitCode = 1
}
