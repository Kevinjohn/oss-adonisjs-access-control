/**
 * The container-resolved `AccessControl` singleton, available once the application has booted.
 * Import only after AdonisJS creates the application; use the value only after boot.
 */
import app from '@adonisjs/core/services/app'
import type { AccessControl } from '../src/define.ts'
import { RuntimeException } from '@adonisjs/core/exceptions'

/** The booted application's `AccessControl` instance. */
let accessControl: AccessControl
if (app === undefined)
  throw new RuntimeException('access-control: services/main requires an AdonisJS application')
await app.booted(async () => {
  accessControl = await app.container.make('access_control.manager')
})
export { accessControl as default }
