import { Bouncer } from '@adonisjs/bouncer'
import type User from '#models/user'

/** An application ability kept alongside the package's generated ones. */
export const viewDashboard = Bouncer.ability((user: User) => {
  return typeof user.id !== 'undefined'
})
