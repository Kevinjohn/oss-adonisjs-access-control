import type { AccountKitConfig, AuthorizationCallbacks } from '@kevinjohn/adonisjs-account-kit'

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
