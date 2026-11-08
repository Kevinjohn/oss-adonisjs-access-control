# Troubleshooting

Symptoms, their causes and the fix, grouped by where they show up. Package errors carry a stable
`E_ACCESS_CONTROL_*` code; the [error reference](../reference/errors.md) lists each one with its
status and message. For setup, see [getting started](getting-started.md) and the
[setup guide](setup.md).

## Setup and boot

| Symptom                                                                                     | Cause                                                                                                | Fix                                                                                                                      |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `configure` stops with `--scope-table=<table> is required`.                                 | The flag is missing.                                                                                 | Pass the table your scope rows live in, for example `--scope-table=teams`.                                               |
| `configure` stops with `config/account_kit.ts is missing`.                                  | Account Kit is not configured yet.                                                                   | Configure Account Kit first, then run `configure` again.                                                                 |
| `configure` leaves a file unchanged.                                                        | The file already exists; `configure` skips it with a message and never rewrites it.                  | Compare the file with the [setup guide](setup.md#what-configure-does) and merge by hand.                                 |
| Boot fails with `config/access_control.ts must export the result of defineAccessControl()`. | The config file exports a plain object.                                                              | Export `defineAccessControl({ ... })`.                                                                                   |
| `no database is attached; register the provider or call attach(db, runner) first`.          | `memberships` was used on an instance the provider never attached, often in a script or a unit test. | Register `@kevinjohn/adonisjs-access-control/access_control_provider` and boot the application before using the service. |

`E_ACCESS_CONTROL_INVALID_CONFIG` at boot names the problem after
`access-control: invalid configuration:`. `defineAccessControl` validates the declaration when
`config/access_control.ts` loads, without reading the database.

| Message names                                                    | Fix                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `roles must list at least one role`                              | Give `roles` at least one name.                                                    |
| `role name ... must match ^[a-z][a-z0-9_-]*$` or `duplicate ...` | Use unique lower-case names of up to 32 characters.                                |
| `resource name ...` or `action name ...`                         | Use names matching `^[a-z][a-zA-Z0-9]*$`.                                          |
| `permission resource:action names ..., not a role`               | Name a role from `roles` as the key's lowest role.                                 |
| `reserved key ... is missing`                                    | Declare `members:list`, `members:manage` and `invitations:manage`.                 |
| `ownerRole needs at least two roles` or `must be the last role`  | Put the owner role last, after at least one other role.                            |
| `... is not a plain SQL identifier`                              | Use a plain table name for `users.table`, `scope.table` and `membershipsTable`.    |
| `... must be integer, string or uuid`                            | Set `users.keyType` and `scope.keyType` to match the primary keys of those tables. |

## The doctor reports a problem

`node ace access-control:doctor` exits 0 when every check is clean, 1 when a check finds rows and
2 when a check could not run. Exit 2 prints `access-control: the doctor could not run:` and the
reason: an unreachable database, or a `--scope` value that is not a valid key.

| Check                    | Cause                                                                    | Fix                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `memberships_table`      | The table is missing, or the columns in `sampleIds` are.                 | Run the published migration, or check `membershipsTable` names the table the migration created.                   |
| `unknown_role`           | Rows store a role that is not in `roles`, usually after a rename.        | Rewrite the stored names with a data migration ([changing roles](changing-roles.md#rename-a-role)).               |
| `unknown_status`         | Rows hold a status other than `active` or `suspended`.                   | Fix the rows; the package writes only those two values.                                                           |
| `scope_without_owner`    | With `ownerRole` set, a scope with members has no active owner.          | Assign one owner per scope ([turn the owner role on](changing-roles.md#turn-the-owner-role-on-later)).            |
| `scope_with_many_owners` | With `ownerRole` set, a scope has more than one active owner.            | Demote all but one with a data migration; the package never creates a second owner itself.                        |
| `orphan_scope`           | Memberships point at a scope row that is gone.                           | Delete the rows, and delete scopes through [`removeAllForScope`](../recipes/index.md#delete-a-team) from now on.  |
| `orphan_user`            | Memberships point at a user row that is gone.                            | Delete the rows, and wire the [account deletion callback](account-kit.md#account-deletion-and-export).            |
| `account_kit_version`    | The installed Account Kit is not the exact version this release expects. | Install the Account Kit release named in the [setup guide](setup.md), or the Access Control release that matches. |

On MySQL the role and status checks compare exact bytes, as the package does at runtime, so
`EDITOR` is reported even though MySQL's default collation treats it as `editor`.

## Every scoped request answers 403

The scope middleware answers `E_ACCESS_CONTROL_FORBIDDEN` for each of these and never says which:

- No `ctx.auth.user`: the scope middleware runs before Account Kit's middleware, or the route has
  no authentication. Put `kitAccount` first, as the [Bouncer guide](bouncer.md#the-scope-middleware)
  shows.
- No scope key: the route parameter is not called `scopeId`. Rename it, or pass `resolveScope`.
- The user is not a member, the membership is suspended, or the stored role is no longer in
  `roles`. Check the row with `memberships.find(scopeId, userId)` and run the doctor.
- The key is malformed for its key type, for example `abc` for an `integer` scope.

## A member is refused by a Bouncer ability

A generated ability returns false, and `bouncer.authorize` throws `E_AUTHORIZATION_FAILURE`, when:

- `ctx.membership` is not set: the route skips `middleware.scope()`, or you built the Bouncer
  outside a scoped route. Pass a resolver that returns the membership you read yourself.
- The membership belongs to another user than the Bouncer's subject. Build the Bouncer for the
  user the membership belongs to; under view-as, that is the effective user.
- The membership is suspended or its role is unknown.
- The role ranks below the key's lowest role. That is the intended answer.

A key that is not declared compiles only when the Bouncer is built from the `services/main`
singleton, which is typed as a bare `AccessControl`; build it from `#config/access_control`.

## `E_ACCESS_CONTROL_INVALID_INPUT` shows up as a 500

With AdonisJS's default exception handler the error renders itself as a 422. An application whose
handler maps package errors to its own response shape, and treats unmapped codes as server faults,
answers 500 instead: that is deliberate when every request input is validated before the package,
because then `INVALID_INPUT` means a programming fault. When it does reach users, find the input
the application passed through unchecked:

- A route parameter longer than the key limit. String keys are 1 to 254 characters; bound the
  parameter with `router.where(...)` so a longer value matches no route
  ([recipe](../recipes/index.md#map-package-errors-to-your-api)).
- An unvalidated role, status, `limit` (1 to 100) or `cursor`.
- `transferOwnership` to a member who is not active. Check the target first and answer with your
  own refusal.
- A trusted operation called without `trx`: `acceptInvitation`, `grant`, `prepareAccountDeletion`
  and `removeAllForScope` answer `<method> requires a transaction`.
- An invitation whose scope is not spelled the way the package normalises keys (a lower-case UUID,
  a plain integer); acceptance fails.

## Account Kit transaction errors

| Message                                                                              | Cause                                                                                                                                                                        | Fix                                                                                                                           |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Account kit transactions cannot be nested; use the trx you were given`              | A membership method ran without `trx` inside an Account Kit transaction: `transaction(db, ...)`, `authentication.withCurrent` or a kit callback. Without `trx` it opens one. | Pass the callback's `trx` to the method ([transactions and locks](memberships.md#transactions-and-locks)).                    |
| A nested call waits instead of failing                                               | Two copies of Account Kit are installed, so the nesting guard is not shared.                                                                                                 | Resolve one Account Kit version across the application and Access Control.                                                    |
| On SQLite, `Account kit SQLite transaction lock is missing` or `lock row is missing` | The kit's `account_transaction_lock` table or its row with `id` 1 is absent, often in a test database.                                                                       | Run the kit's migrations, or create the row in test setup ([setup guide](setup.md#testing-your-application)).                 |
| A deadlock on PostgreSQL or MySQL inside `withCurrent`                               | A membership change for another user ran while the current account's row was locked.                                                                                         | Run cross-user membership changes in their own transaction ([transactions and locks](memberships.md#transactions-and-locks)). |

## Other refusals

| Code                               | Cause                                                                                                                                         | Fix                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `E_ACCESS_CONTROL_UNKNOWN_ROLE`    | A role was renamed or removed without a data migration, or an unvalidated role reached the service.                                           | Run the doctor and migrate stored names; validate roles against `roles`.                     |
| `E_ACCESS_CONTROL_LAST_OWNER`      | An active owner tried to delete their account.                                                                                                | Transfer ownership first.                                                                    |
| `E_ACCESS_CONTROL_CONFLICT`        | The member set changed while `removeAllForScope` was locking rows.                                                                            | Run the transaction again.                                                                   |
| `E_ACCESS_CONTROL_SCOPE_NOT_EMPTY` | `createFirstMember` ran on a scope that already has members.                                                                                  | Call it only in the transaction that creates the scope.                                      |
| An Account Kit invite is refused   | The invitation has no scope, the actor lacks `invitations:manage` or is not admitted, or the role ranks above the actor or is the owner role. | Send team invitations with a scope; see the [Account Kit guide](account-kit.md#invitations). |

## Node.js and database drivers

- The package requires Node.js 24 or later. `better-sqlite3` is a native module built for the
  Node.js version that installed it; after switching versions, a `NODE_MODULE_VERSION` error means
  it needs reinstalling under the new version.
- On SQLite, keep better-sqlite3's default `busy_timeout` so a commit can wait for readers; the
  kit's runner retries a busy writer itself.
