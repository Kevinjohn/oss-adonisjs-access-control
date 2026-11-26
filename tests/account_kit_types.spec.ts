import { test } from '@japa/runner'
import type { AccountKitConfig } from '@kevinjohn/adonisjs-account-kit'
import { withInvitationEvidence } from '@kevinjohn/adonisjs-account-kit/admission'
import { accessControlKitCallbacks } from '../account_kit/main.ts'

test('composes callback functions with Account Kit 0.8.0', ({ expectTypeOf }) => {
  const kitCallbacks = accessControlKitCallbacks({ admission: false })

  type CallbackConfig = Pick<
    AccountKitConfig,
    'authorize' | 'onInvitationAccepted' | 'onAccountDeletingTransaction' | 'exportAccountData'
  >
  const callbacks = {
    authorize: kitCallbacks.authorize,
    onInvitationAccepted: withInvitationEvidence(kitCallbacks.onInvitationAccepted),
    onAccountDeletingTransaction: kitCallbacks.onAccountDeletingTransaction,
    exportAccountData: kitCallbacks.exportAccountData,
  }
  expectTypeOf(callbacks).toExtend<CallbackConfig>()

  const composed = accessControlKitCallbacks({
    onInvitationAccepted: kitCallbacks.onInvitationAccepted,
  })
  expectTypeOf(composed).toEqualTypeOf<typeof kitCallbacks>()

  expectTypeOf<{ lazy: true }>().not.toExtend<
    NonNullable<Parameters<typeof accessControlKitCallbacks>[0]>
  >()
})
