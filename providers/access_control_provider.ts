import type { ApplicationService } from '@adonisjs/core/types'
import { AccessControl } from '../src/define.js'
import { AccessControlError } from '../src/errors.js'
import { loadRunner } from '../src/kit_transaction.js'

/**
 * Binds the `AccessControl` instance that `config/access_control.ts` exports as a container
 * singleton with the database attached, and resolves it at boot so a bad config fails early.
 */
export default class AccessControlProvider {
  constructor(protected app: ApplicationService) {}

  /** Bind `AccessControl` (alias `access_control`) as a lazy singleton. */
  register(): void {
    this.app.container.singleton(AccessControl, async (resolver) => {
      const config = this.app.config.get<unknown>('access_control')
      if (!(config instanceof AccessControl))
        throw new AccessControlError('E_ACCESS_CONTROL_INVALID_CONFIG', {
          message:
            'access-control: config/access_control.ts must export the result of defineAccessControl()',
        })
      const db = await resolver.make('lucid.db')
      return config.attach(db, await loadRunner())
    })
    this.app.container.alias('access_control', AccessControl)
  }

  /** Resolve the instance at boot when `config/access_control.ts` exists. */
  async boot(): Promise<void> {
    if (this.app.config.get('access_control') === undefined) return
    await this.app.container.make(AccessControl)
  }
}

declare module '@adonisjs/core/types' {
  export interface ContainerBindings {
    access_control: AccessControl
  }
}
