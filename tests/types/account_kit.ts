// Type-level checks: the callbacks fit Account Kit's config as it is today; never run.
import { defineConfig } from '@kevinjohn/adonisjs-account-kit'
import type { AccountKitConfig } from '@kevinjohn/adonisjs-account-kit'
import { withInvitationEvidence } from '@kevinjohn/adonisjs-account-kit/admission'
import { accessControlKitCallbacks } from '../../account_kit/main.js'

const kitCallbacks = accessControlKitCallbacks({ admission: false })

const partial: Pick<
  AccountKitConfig,
  'authorize' | 'onInvitationAccepted' | 'onAccountDeletingTransaction' | 'exportAccountData'
> = {
  authorize: kitCallbacks.authorize,
  onInvitationAccepted: withInvitationEvidence(kitCallbacks.onInvitationAccepted),
  onAccountDeletingTransaction: kitCallbacks.onAccountDeletingTransaction,
  exportAccountData: kitCallbacks.exportAccountData,
}
void partial
void defineConfig

const composed = accessControlKitCallbacks({
  onInvitationAccepted: kitCallbacks.onInvitationAccepted,
})
void composed

// @ts-expect-error unknown option
accessControlKitCallbacks({ lazy: true })
