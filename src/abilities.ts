// Bouncer abilities (specification section 8): one per permission key, resolving the membership lazily.
import { Bouncer } from '@adonisjs/bouncer'
import type { BouncerAbility } from '@adonisjs/bouncer/types'
import type { AccessControl } from './define.ts'

import type { AbilityMap, AbilitySubject, MembershipResolver } from './ability_types.ts'

/**
 * One ability per key, named by the key. Each execution resolves the membership, denies a
 * missing, inactive or other-subject membership, and otherwise asks `can(role, key)`. Guests
 * are denied by Bouncer itself (`allowGuest: false`).
 */
export function createAbilities<P>(
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
