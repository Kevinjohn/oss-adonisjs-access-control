# Account Kit

Account Kit owns accounts and invitations; Access Control owns memberships. The package provides
the kit's callbacks so that an invitation carries a scope and a role, acceptance creates the
membership, account deletion removes memberships, and the data export includes them.

## Wiring

```ts
// config/account_kit.ts
import { defineConfig } from '@kevinjohn/adonisjs-account-kit'
import { accessControlKitCallbacks } from '@kevinjohn/adonisjs-access-control/account-kit'

const kitCallbacks = accessControlKitCallbacks()

export default defineConfig({
  // ...
  authorize: kitCallbacks.authorize,
  onInvitationAccepted: kitCallbacks.onInvitationAccepted,
  onAccountDeletingTransaction: kitCallbacks.onAccountDeletingTransaction,
  exportAccountData: kitCallbacks.exportAccountData,
})
```

The callbacks are created while the configuration file loads, before any provider boots, so they
look the `AccessControl` instance up on every call rather than at creation.

## Invitations

| Callback                     | Answer                                                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authorize.invite`           | True when the actor is an active member of `context.scope` with `invitations:manage`, the invited role is known, is not the owner role and ranks at or below the actor's, and the actor is admitted. |
| `authorize.manageInvitation` | The same checks against the invitation's own scope and role.                                                                                                                                         |
| `authorize.listInvitations`  | True when the actor is an active member of `context.scope` with `invitations:manage` and is admitted.                                                                                                |

The checks read through the kit's transaction when one is given and never lock rows, so they
cannot change the kit's lock order. An invitation without a scope is not a team invitation and is
refused by these callbacks; keep your own callbacks for those if you send them.

`onInvitationAccepted` creates the membership for the invitation's scope and role inside the
kit's acceptance transaction. A deleted scope, a role that no longer exists, the owner role or an
existing membership makes the whole acceptance fail, so no account is created for an invitation
that cannot be honoured. Invitations are stored grants: acceptance does not check the inviter
again. An invitation without a scope creates nothing.

To keep an existing callback, pass it in; it runs after the membership exists, in the same
transaction:

```ts
const kitCallbacks = accessControlKitCallbacks({
  onInvitationAccepted: async (user, invitation, trx) => {
    /* your own work through trx */
  },
})
```

## Admission

When the kit's admission module is registered, every `authorize` callback also asks
`AccountAdmission.isAdmitted(actor.id, trx)` and refuses an actor who is not admitted. Pass
`admission: false` to skip that check. Without the admission provider nothing is asked.

With admission evidence enabled, compose the kit's helper around the package callback so the
evidence row and the membership are written in one transaction:

```ts
import { withInvitationEvidence } from '@kevinjohn/adonisjs-account-kit/admission'

onInvitationAccepted: withInvitationEvidence(kitCallbacks.onInvitationAccepted)
```

## Account deletion and export

`onAccountDeletingTransaction` removes every membership of the account inside the kit's deletion
transaction, emitting `membership.removed` with `reason: 'account_deleted'` for each, so the
foreign key lets the account row go afterwards. An account that is still the active owner of a
scope is refused with `E_ACCESS_CONTROL_LAST_OWNER`: transfer ownership first.

`exportAccountData` returns `{ memberships: [{ scopeId, role, status, createdAt, updatedAt }] }`.
If you already export application data, call the package callback from yours and merge the two
objects.

## Identity administration

Before a kit operation taken by one user on another (a password reset request, a session
revocation), call `memberships.assertCanAdministerIdentity({ actorId, targetId })`. It throws
`E_ACCESS_CONTROL_FORBIDDEN` unless the actor may manage the target in every scope the target
belongs to. Run it immediately before the kit operation, in its own transaction; the kit opens its
own and may send mail, so the two cannot share one.
