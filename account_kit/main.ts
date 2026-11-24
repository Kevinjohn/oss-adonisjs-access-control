/**
 * Account Kit callbacks: invitation authorization, acceptance, account deletion and export.
 * Specification section 9. The callbacks are created in `config/account_kit.ts`, before any
 * provider boots, so they resolve `AccessControl` from the container on every call.
 */
import app from '@adonisjs/core/services/app'
import type {
  AccountKitConfig,
  AccountUser,
  AuthorizationCallbacks,
  Trx,
} from '@kevinjohn/adonisjs-account-kit'
import { AccessControl } from '../src/define.js'
import {
  E_ACCESS_CONTROL_INVALID_INVITATION_SCOPE,
  E_ACCESS_CONTROL_INVALID_KEY,
  E_ACCESS_CONTROL_SCOPE_NOT_FOUND,
} from '../src/errors.js'
import { isCanonicalKey } from '../src/keys.js'
import type { Membership, UserKey } from '../src/types.js'

/** Options of `accessControlKitCallbacks`. */
export interface AccessControlKitCallbackOptions {
  /** Existing app callback to run after the package's, in the same transaction. */
  onInvitationAccepted?: AccountKitConfig['onInvitationAccepted']
  /** Set false to skip admission checks even when the admission provider is registered. */
  admission?: boolean
}

/** The callbacks to spread into `defineConfig` in `config/account_kit.ts`. */
export interface AccessControlKitCallbacks {
  /** `invite`, `manageInvitation` and `listInvitations`, each a plain read that never locks. */
  authorize: AuthorizationCallbacks
  /** Creates the membership an accepted team invitation grants, then runs the app's callback. */
  onInvitationAccepted: NonNullable<AccountKitConfig['onInvitationAccepted']>
  /** Removes the user's memberships, or refuses while the user is an active owner. */
  onAccountDeletingTransaction: NonNullable<AccountKitConfig['onAccountDeletingTransaction']>
  /** The user's memberships for the kit's account export. */
  exportAccountData: NonNullable<AccountKitConfig['exportAccountData']>
}

/** The part of the kit's `AccountAdmission` service the callbacks use. */
interface AdmissionService {
  isAdmitted(userId: UserKey, trx?: Trx): Promise<boolean>
}

const admissionBinding = 'account_admission'

async function resolveAccessControl(): Promise<AccessControl> {
  return app.container.make(AccessControl)
}

/** True when admission is off, the admission provider is absent, or the kit admits the user. */
async function checkAdmission({
  userId,
  trx,
  enabled,
}: {
  userId: UserKey
  trx: Trx | undefined
  enabled: boolean
}): Promise<boolean> {
  if (!enabled || !app.container.hasBinding(admissionBinding)) return true
  const admission = (await app.container.make(admissionBinding)) as AdmissionService
  return admission.isAdmitted(userId, trx)
}

/**
 * `scope` when it is spelled the way the package normalises keys (specification 5.1); otherwise
 * null. The kit stores invitation scopes as given and accepts them in that order, so an alias
 * (an upper-case UUID) would make the kit's acceptance order differ from the package's lock
 * order. Team invitations are authorised and honoured for the canonical spelling only.
 */
function readCanonicalInvitationScope(
  access: AccessControl,
  scope: string | null | undefined
): string | null {
  if (scope === null || scope === undefined) return null
  return isCanonicalKey(access.config.scope.keyType, scope) ? scope : null
}

interface InvitationSubject {
  actor: AccountUser
  scope: string | null | undefined
  trx: Trx | undefined
}

interface InvitationManagementSubject extends InvitationSubject {
  admission: boolean
}

/** The actor's active membership in `scope`, read through `trx` without locking; null otherwise. */
async function getActiveMembership(
  { actor, scope, trx }: InvitationSubject,
  access: AccessControl
): Promise<Membership | null> {
  const canonical = readCanonicalInvitationScope(access, scope)
  if (canonical === null) return null
  try {
    const membership = await access.memberships.getMembershipInRequiredInvitationScope(
      canonical,
      actor.id,
      trx
    )
    return membership !== null && membership.status === 'active' ? membership : null
  } catch (error) {
    if (
      error instanceof E_ACCESS_CONTROL_INVALID_INVITATION_SCOPE ||
      error instanceof E_ACCESS_CONTROL_INVALID_KEY ||
      error instanceof E_ACCESS_CONTROL_SCOPE_NOT_FOUND
    )
      return null
    throw error
  }
}

/** The admitted actor's active membership when it grants invitation management. */
async function getInvitationManagerMembership(
  { actor, scope, trx, admission }: InvitationManagementSubject,
  access: AccessControl
): Promise<Membership | null> {
  const membership = await getActiveMembership({ actor, scope, trx }, access)
  if (membership === null || !access.can(membership.role, 'invitations:manage')) return null
  if (!(await checkAdmission({ userId: actor.id, trx, enabled: admission }))) return null
  return membership
}

/** Checks whether the actor can invite someone with the given role into the scope. */
async function checkInvitationPermission({
  role,
  ...subject
}: InvitationManagementSubject & { role: string }): Promise<boolean> {
  const access = await resolveAccessControl()
  if (access.rank(role) < 0 || role === access.ownerRole) return false
  const membership = await getInvitationManagerMembership(subject, access)
  return membership !== null && access.rank(role) <= access.rank(membership.role)
}

/**
 * Builds the Account Kit callbacks backed by the application's `AccessControl`. Call it in
 * `config/account_kit.ts`; nothing is resolved until the kit calls a callback.
 *
 * @example
 * ```ts
 * import { accessControlKitCallbacks } from '@kevinjohn/adonisjs-access-control/account-kit'
 * import { defineConfig } from '@kevinjohn/adonisjs-account-kit'
 *
 * export default defineConfig({
 *   ...accountOptions,
 *   ...accessControlKitCallbacks(),
 * })
 * ```
 */
export function accessControlKitCallbacks(
  options: AccessControlKitCallbackOptions = {}
): AccessControlKitCallbacks {
  const admission = options.admission !== false
  return {
    // Return a uniform refusal to Account Kit so invitations cannot reveal scope membership.
    authorize: {
      async invite(actor, role, context) {
        return checkInvitationPermission({
          actor,
          role,
          scope: context?.scope,
          trx: context?.trx,
          admission,
        })
      },
      async manageInvitation(actor, invitation, context) {
        return checkInvitationPermission({
          actor,
          role: invitation.role,
          scope: invitation.scope,
          trx: context?.trx,
          admission,
        })
      },
      async listInvitations(actor, context) {
        const access = await resolveAccessControl()
        const membership = await getInvitationManagerMembership(
          { actor, scope: context?.scope, trx: context?.trx, admission },
          access
        )
        return membership !== null
      },
    },
    async onInvitationAccepted(user, invitation, trx) {
      if (invitation.scope !== null) {
        const access = await resolveAccessControl()
        if (readCanonicalInvitationScope(access, invitation.scope) === null)
          throw new E_ACCESS_CONTROL_INVALID_INVITATION_SCOPE(
            `invitation ${invitation.id}: scope must be a canonical ${access.config.scope.keyType} key`
          )
        await access.memberships.acceptInvitation({
          scopeId: invitation.scope,
          userId: user.id,
          role: invitation.role,
          invitationId: invitation.id,
          trx,
        })
      }
      await options.onInvitationAccepted?.(user, invitation, trx)
    },
    async onAccountDeletingTransaction(user, trx) {
      const access = await resolveAccessControl()
      await access.memberships.prepareAccountDeletion({ userId: user.id, trx })
    },
    async exportAccountData(user, trx) {
      const access = await resolveAccessControl()
      return access.memberships.exportFor({ userId: user.id, trx })
    },
  }
}
