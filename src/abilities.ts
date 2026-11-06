// Bouncer abilities (specification section 8): one per permission key, resolving the membership lazily.
import { Bouncer } from '@adonisjs/bouncer'
import type { BouncerAbility } from '@adonisjs/bouncer/types'
import type { AccessControl } from './define.js'
import type { Membership, PermissionKeyOf, UserKey } from './types.js'

/** The subject every generated ability accepts: any user model with an `id`. */
export interface AbilitySubject {
  id: UserKey
}

/** A resolver read on every ability execution, never captured at construction. */
export type MembershipResolver = () => Membership | null | undefined

/** `{ 'project:write': BouncerAbility, ... }` for the keys of a permission map. */
export type AbilityMap<P> = { [K in PermissionKeyOf<P>]: BouncerAbility<AbilitySubject> }

/**
 * One ability per key, named by the key. Each execution resolves the membership, denies a
 * missing, inactive or other-subject membership, and otherwise asks `can(role, key)`. Guests
 * are denied by Bouncer itself (`allowGuest: false`).
 */
export function abilities<P>(
  access: AccessControl<any, any>,
  resolve: MembershipResolver
): AbilityMap<P> {
  const map: Record<string, BouncerAbility<AbilitySubject>> = {}
  for (const key of access.permissionKeys as string[]) {
    map[key] = Bouncer.ability((user: AbilitySubject) => {
      const membership = resolve()
      if (!membership) return false
      if (membership.status !== 'active') return false
      if (String(membership.userId) !== String(user.id)) return false
      return access.can(membership.role, key)
    })
  }
  return map as AbilityMap<P>
}
