/**
 * The container-resolved `AccessControl` singleton, available once the application has booted.
 * Outside an AdonisJS application (for example when the export map is probed) the app service
 * is undefined and the default export stays undefined.
 */
import app from '@adonisjs/core/services/app'
import { AccessControl } from '../src/define.js'

/** The booted application's `AccessControl` instance. */
let accessControl: AccessControl
if (app !== undefined)
  await app.booted(async () => {
    accessControl = await app.container.make(AccessControl)
  })
export { accessControl as default }
