/**
 * Account Kit callbacks: invitation authorization, acceptance, account deletion and export.
 * Specification section 9. The callbacks are created in `config/account_kit.ts`, before any
 * provider boots, so they resolve `AccessControl` from the container on every call.
 */
import app from '@adonisjs/core/services/app'
import type {
  AccountKitConfig,
  AccountUser,
  AuthorizationContext,
  Invitation,
  Trx,
} from '@kevinjohn/adonisjs-account-kit'
import { AccessControl } from '../src/define.js'
import { AccessControlError } from '../src/errors.js'
import type { Membership, UserKey } from '../src/types.js'

/** The kit's authorization context with the scope Account Kit #768 adds: a string or null. */
export interface ScopedAuthorizationContext extends AuthorizationContext {
  /** The scope the invitation belongs to, or null for an invitation outside any scope. */
  scope?: string | null
}

/** A kit invitation with the scope Account Kit #768 stores on it. */
export interface ScopedInvitation extends Invitation {
  /** The scope the invitation grants a role in, or null for an invitation outside any scope. */
  scope?: string | null
}

/**
 * The kit's `authorize` callbacks with the scope Account Kit #768 passes. Assignable to the kit's
 * `AuthorizationCallbacks` as they stand today, where the scope is simply absent.
 */
export interface ScopedAuthorizationCallbacks {
  /** Whether `actor` may invite someone with `role` into `context.scope`. */
  invite(actor: AccountUser, role: string, context?: ScopedAuthorizationContext): Promise<boolean>
  /** Whether `actor` may resend or revoke `invitation` in its scope. */
  manageInvitation(
    actor: AccountUser,
    invitation: ScopedInvitation,
    context?: ScopedAuthorizationContext
  ): Promise<boolean>
  /** Whether `actor` may list the invitations of `context.scope`. */
  listInvitations(actor: AccountUser, context?: ScopedAuthorizationContext): Promise<boolean>
}

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
  authorize: ScopedAuthorizationCallbacks
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
async function admitted(userId: UserKey, trx: Trx | undefined, enabled: boolean): Promise<boolean> {
  if (!enabled || !app.container.hasBinding(admissionBinding)) return true
  const admission = (await app.container.make(admissionBinding)) as AdmissionService
  return admission.isAdmitted(userId, trx)
}

/** The actor's active membership in `scope`, read through `trx` without locking; null otherwise. */
async function activeMembership(
  access: AccessControl,
  actor: AccountUser,
  scope: string | null | undefined,
  trx: Trx | undefined
): Promise<Membership | null> {
  if (scope === null || scope === undefined) return null
  try {
    const membership = await access.memberships.find(scope, actor.id, trx)
    return membership !== null && membership.status === 'active' ? membership : null
  } catch (error) {
    if (error instanceof AccessControlError && error.code === 'E_ACCESS_CONTROL_INVALID_INPUT')
      return null
    throw error
  }
}

/** Whether `actor` may manage invitations in `scope`: admitted, active there, holding the key. */
async function mayManageInvitations(
  actor: AccountUser,
  scope: string | null | undefined,
  trx: Trx | undefined,
  admission: boolean
): Promise<Membership | null> {
  const access = await resolveAccessControl()
  const membership = await activeMembership(access, actor, scope, trx)
  if (membership === null || !access.can(membership.role, 'invitations:manage')) return null
  if (!(await admitted(actor.id, trx, admission))) return null
  return membership
}

/** Whether `actor` may invite someone with `role` into `scope`. */
async function mayInvite(
  actor: AccountUser,
  role: string,
  scope: string | null | undefined,
  trx: Trx | undefined,
  admission: boolean
): Promise<boolean> {
  const access = await resolveAccessControl()
  if (access.rank(role) < 0 || role === access.ownerRole) return false
  const membership = await mayManageInvitations(actor, scope, trx, admission)
  return membership !== null && access.rank(role) <= access.rank(membership.role)
}

/**
 * Builds the Account Kit callbacks backed by the application's `AccessControl`. Call it in
 * `config/account_kit.ts`; nothing is resolved until the kit calls a callback.
 */
export function accessControlKitCallbacks(
  options: AccessControlKitCallbackOptions = {}
): AccessControlKitCallbacks {
  const admission = options.admission !== false
  return {
    authorize: {
      async invite(actor, role, context) {
        return mayInvite(actor, role, context?.scope, context?.trx, admission)
      },
      async manageInvitation(actor, invitation, context) {
        return mayInvite(actor, invitation.role, invitation.scope, context?.trx, admission)
      },
      async listInvitations(actor, context) {
        const membership = await mayManageInvitations(
          actor,
          context?.scope,
          context?.trx,
          admission
        )
        return membership !== null
      },
    },
    async onInvitationAccepted(user, invitation: ScopedInvitation, trx) {
      if (invitation.scope !== null && invitation.scope !== undefined) {
        const access = await resolveAccessControl()
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
