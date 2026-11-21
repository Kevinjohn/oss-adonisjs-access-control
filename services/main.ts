/**
 * The container-resolved `AccessControl` singleton, available once the application has booted.
 * Import only after AdonisJS creates the application; use the value only after boot.
 */
import app from '@adonisjs/core/services/app'
import { AccessControl } from '../src/define.js'
import { AccessControlError } from '../src/errors.js'

/** The booted application's `AccessControl` instance. */
let accessControl: AccessControl
if (app === undefined)
  throw new AccessControlError('E_ACCESS_CONTROL_INVALID_CONFIG', {
    message: 'access-control: services/main requires an AdonisJS application',
  })
await app.booted(async () => {
  accessControl = await app.container.make(AccessControl)
})
export { accessControl as default }
