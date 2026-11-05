import { BaseCommand, flags } from '@adonisjs/core/ace'
import { AccessControl } from '../src/define.js'
import { accountKitVersions, runDoctor } from '../src/doctor.js'

/**
 * `node ace access-control:doctor [--scope=<id>] [--json]`: read-only checks of the memberships
 * table against the configuration. Exit code 0 when clean, 1 when a check finds rows, 2 when a
 * check could not run.
 */
export default class AccessControlDoctor extends BaseCommand {
  static commandName = 'access-control:doctor'
  static description = 'Check the memberships table against config/access_control.ts'
  static options = { startApp: true }

  @flags.string({ description: 'Restrict the row checks to one scope id' })
  declare scope?: string

  @flags.boolean({ description: 'Print the report as JSON' })
  declare json: boolean

  async run(): Promise<void> {
    try {
      const access = await this.app.container.make(AccessControl)
      const db = await this.app.container.make('lucid.db')
      const report = await runDoctor({
        access,
        db,
        scope: this.scope,
        accountKit: accountKitVersions(),
      })
      if (this.json) {
        this.logger.log(JSON.stringify(report))
      } else {
        for (const entry of report.checks) {
          const detail = entry.sampleIds.length > 0 ? ` (${entry.sampleIds.join(', ')})` : ''
          const line = `${entry.name}: ${entry.count}${detail}`
          if (entry.ok) this.logger.success(line)
          else this.logger.error(line)
        }
      }
      this.exitCode = report.checks.some((entry) => !entry.ok) ? 1 : 0
    } catch (error) {
      this.logger.error(`access-control: the doctor could not run: ${(error as Error).message}`)
      this.exitCode = 2
    }
  }
}
