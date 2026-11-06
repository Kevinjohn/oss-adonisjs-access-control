# Memberships

The membership service stores one row per user and scope with a role and a status. It is
reached through the configured `AccessControl` instance:

```ts
import accessControl from '@kevinjohn/adonisjs-access-control/services/main'

const page = await accessControl.memberships.listForScope({ actor: { id: user.id }, scopeId })
```

A membership is `{ scopeId, userId, role, status, createdAt, updatedAt }`. Keys are normalised to
the configured key types on the way in: a numeric string becomes a number for `integer` keys, a
UUID is lower-cased, and anything else is `E_ACCESS_CONTROL_INVALID_INPUT`.

## Actor-authorised operations

Every write takes an `actor` (the acting user), opens a transaction through Account Kit's runner,
locks the rows in a fixed order, loads the actor's own membership in the scope and applies the
[rules](rules.md). The actor must be an active member; a missing or suspended actor gets
`E_ACCESS_CONTROL_FORBIDDEN` before the target is looked at, so a non-manager cannot learn
whether someone is a member from a 404 versus a 403.

| Method              | Input                                       | Result             | Event                              |
| ------------------- | ------------------------------------------- | ------------------ | ---------------------------------- |
| `find`              | `scopeId, userId, trx?`                     | membership or null | none                               |
| `listForUser`       | `userId, trx?`                              | memberships        | none                               |
| `listForScope`      | `{ actor, scopeId, cursor?, limit?, trx? }` | a page             | none                               |
| `add`               | `{ actor, scopeId, userId, role, trx? }`    | membership         | `membership.added`                 |
| `changeRole`        | `{ actor, scopeId, userId, role, trx? }`    | membership         | `membership.role_changed`          |
| `setStatus`         | `{ actor, scopeId, userId, status, trx? }`  | membership         | `membership.status_changed`        |
| `remove`            | `{ actor, scopeId, userId, trx? }`          | nothing            | `membership.removed`               |
| `leave`             | `{ scopeId, userId, trx? }`                 | nothing            | `membership.left`                  |
| `transferOwnership` | `{ actor, scopeId, toUserId, trx? }`        | nothing            | `membership.ownership_transferred` |

- `listForScope` requires `members:list`, pages by `created_at` then `id` with an opaque cursor,
  and accepts a `limit` from 1 to 100 (default 25).
- `add` requires the user row to exist (`USER_NOT_FOUND`) and no existing membership
  (`ALREADY_MEMBER`).
- `changeRole` and `setStatus` skip the write and the event when nothing changes.
- `transferOwnership` requires the owner role to be configured, the actor to be the active owner
  and the target to be an active member who is not the actor. The old owner is demoted to the
  highest non-owner role in the same transaction.
- `leave` takes no actor and works for a suspended member. Route it without the scope middleware,
  which refuses suspended members.

## Trusted operations

These take no actor and must stay behind your own checks; never expose them to request input
directly.

| Method                        | Purpose                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createFirstMember`           | Seeds a new scope with its owner (or a manager role when no owner role is set). Refuses a non-empty scope with `SCOPE_NOT_EMPTY`.                                                                      |
| `acceptInvitation`            | Creates the membership an accepted Account Kit invitation grants, inside the kit's transaction. The [Account Kit guide](account-kit.md) wires it.                                                      |
| `identityRoles`               | Loads the actor's active memberships and all of the target's, under locks, for `canAdministerIdentity`.                                                                                                |
| `assertCanAdministerIdentity` | Throws `FORBIDDEN` unless the actor may administer the target across every scope.                                                                                                                      |
| `prepareAccountDeletion`      | Removes every membership of a user inside the kit's deletion transaction; refuses an active owner with `LAST_OWNER`.                                                                                   |
| `removeAllForScope`           | Removes every membership of a scope inside your scope-deletion transaction, just before you delete the scope row. A member set that changed since the first read is `CONFLICT`; retry the transaction. |
| `exportFor`                   | The user's memberships with ISO timestamps, for the kit's data export.                                                                                                                                 |

## Events

`onMembershipChanged(event, trx)` in the configuration runs inside the write transaction after the
row changes, with the same `trx`. Throwing rolls the write back. Use it for audit rows written
through `trx`, or to queue notifications that a commit hook sends afterwards.

Event types: `membership.added`, `membership.first_member`, `membership.invitation_accepted`,
`membership.role_changed`, `membership.status_changed`, `membership.removed` (with `reason`:
`removed`, `scope_deleted` or `account_deleted`), `membership.left` and
`membership.ownership_transferred`. The `MembershipEvent<Role>` union in
`@kevinjohn/adonisjs-access-control/types` describes each payload.

## Transactions and locks

Writes lock the user rows involved first, ascending by the string form of their keys, then the
scope rows, ascending. Every package operation and every Account Kit callback keeps this order, so
two writers never wait on each other in a cycle. On SQLite the package shares Account Kit's
`account_transaction_lock` row, so package writes and kit writes serialise.

Pass your own `trx` to run a membership change inside a larger transaction; the package then
locks and writes through it and leaves commit and rollback to you. Three rules keep that safe:

- Start `trx` with the kit's runner, `transaction(db, callback)` from
  `@kevinjohn/adonisjs-account-kit/transaction`, not with `db.transaction()`. The runner sets the
  isolation level and SQLite's shared lock row; under MySQL's default repeatable read a plain
  Lucid transaction keeps reading the snapshot it started with, so two concurrent ownership
  transfers could both see the old owner and leave a scope with two owners.
- Do not hold a user row lock before calling in. Account Kit's `authentication.withCurrent` locks
  the current account first; a membership change from inside it that targets another user locks
  the users in key order and can wait on a writer that holds the other user and waits for this
  one. Run cross-user membership changes in their own transaction.
- Do not lock the scope row yourself before `removeAllForScope`; it locks the member users first,
  then the scope, and a lock taken in the other order can deadlock with a concurrent change.

```ts
import db from '@adonisjs/lucid/services/db'
import { transaction } from '@kevinjohn/adonisjs-account-kit/transaction'

await transaction(db, async (trx) => {
  await accessControl.memberships.transferOwnership({ actor, scopeId, toUserId, trx })
  await Project.query({ client: trx }).where('team_id', scopeId).update({ owner_id: toUserId })
})
```

## Errors

Every error is an `AccessControlError` with a code from the
[error reference](../reference/errors.md), an HTTP status and a message. Handled by the
application's exception handler, it renders `{ errors: [{ code, message }] }` with
`Cache-Control: no-store`.
