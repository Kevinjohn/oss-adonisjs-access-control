import type { ApplicationService } from '@adonisjs/core/types'

/**
 * Registers the access-control service in the container. The container binding arrives with
 * the membership service milestone; the scaffold registers nothing.
 */
export default class AccessControlProvider {
  constructor(protected app: ApplicationService) {}

  /** Container registrations; none yet. */
  register(): void {}
}
