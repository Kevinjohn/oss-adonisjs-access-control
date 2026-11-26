import type { BouncerAbility } from '@adonisjs/bouncer/types'
import type { Membership, PermissionKeyOf, UserKey } from './types.ts'

/** The subject every generated ability accepts: any user model with an `id`. */
export interface AbilitySubject {
  id: UserKey
}

/** A resolver read on every ability execution, never captured at construction. */
export type MembershipResolver = () => Membership | null | undefined

/** `{ 'project:write': BouncerAbility, ... }` for the keys of a permission map. */
export type AbilityMap<P> = { [K in PermissionKeyOf<P>]: BouncerAbility<AbilitySubject> }
