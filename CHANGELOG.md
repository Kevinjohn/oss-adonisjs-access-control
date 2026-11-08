# Changelog

## Unreleased

### Added

- Docs: a getting started guide, a troubleshooting guide, recipes from adopting the package in a
  single-company application (single-scope setup, a shared permission declaration, a per-row
  manage flag, error mapping, stricter product rules, Bouncer inside the request transaction),
  a section on replacing a home-grown access layer, the doctor in CI, and which error codes a user
  can reach. The documentation index follows the shape of the sibling packages.

### Fixed

- Docs: the errors reference no longer lists a missing Account Kit lock row under
  `E_ACCESS_CONTROL_INVALID_CONFIG`; Account Kit raises its own error for it. The team creation
  and deletion recipes start their transaction with Account Kit's runner, as the memberships guide
  requires.

## 0.1.5 - 2026-11-08

### Added

- An Inertia Vue example built on Account Kit's Inertia Vue example, in
  `examples/with_account_kit/inertia_vue`, for the starter examples sandbox.

### Changed

- Docs: the Bouncer guide's middleware is now the consumer example's file, and a test keeps them in
  step.

## 0.1.4 - 2026-11-08

### Changed

- Requires Account Kit 0.3.2 (exact).

### Fixed

- Examples: the API and Inertia React `.gitignore` describe `vendor` as a packed package build, matching Account Kit, so the starter examples sandbox merges them without a conflict. Closes #25.

## 0.1.3 - 2026-11-07

### Added

- Examples: Account Kit's API, Hypermedia and Inertia React starter examples with Access Control
  added, in `examples/with_account_kit/`. Accounts create teams, invite members with a role through
  Account Kit's scoped invitations, and scoped routes check permission keys with Bouncer. They feed
  the [starter examples sandbox](https://github.com/Kevinjohn/oss-adonisjs-starter-examples).

## 0.1.2 - 2026-11-07

### Added

- Verified and documented running membership operations inside Account Kit's
  `authentication.withCurrent` on SQLite with the supplied `trx` (one process, one database file,
  one-connection pool). Row-locking databases keep the cross-user warning.
- `memberships.grant`: a trusted operation that creates a membership inside the application's
  transaction after the application's own checks, emitting `membership.granted`.

## 0.1.1 - 2026-11-07

### Changed

- Account Kit peer is `0.3.1` (exact); the dev dependency and the example consumer install its
  release tarball.

## 0.1.0 - 2026-11-06

### Migrations

- `access_control_create_memberships`: the memberships table with `RESTRICT` foreign keys to the users and scope
  tables, a unique `(scope_id, user_id)` key and the paging index. Recorded in
  `stubs/migrations/released.json`.

### Changed

- Account Kit peer is `0.3.0` (exact), the first release with the `./transaction` export, scoped
  invitations and `ctx.auth.user` after the kit middleware; the dev dependency and the example
  consumer install its release tarball.

### Added

- `node ace configure @kevinjohn/adonisjs-access-control --scope-table=<table>` writes
  `config/access_control.ts`, publishes the released migrations, registers the provider, the
  commands and the named `scope` middleware, and prints the Bouncer and Account Kit changes.
  Flags: `--scope-id-type`, `--users-table`, `--user-id-type`, `--memberships-table`. Existing
  files are never rewritten.
- `node ace access-control:doctor [--scope=<id>] [--json]`: read-only checks of the memberships
  table against the configuration (table and columns, unknown roles and statuses, scopes without
  or with several active owners, orphan rows, the installed Account Kit version). Exit code 0, 1
  when rows are found, 2 when a check could not run.
- User guides under `docs/guide/` (including adopting an existing memberships table) and recipes.
- Account Kit callbacks (`@kevinjohn/adonisjs-access-control/account-kit`):
  `accessControlKitCallbacks(options)` returns `authorize` (`invite`, `manageInvitation`,
  `listInvitations`: plain reads through `context.trx`, scoped by `context.scope` or
  `invitation.scope`, admission-checked when the kit's admission provider is bound),
  `onInvitationAccepted` (creates the membership, then runs the app's callback),
  `onAccountDeletingTransaction` and `exportAccountData`. `AccessControl` is resolved from the
  container on every call, so the callbacks can be created in `config/account_kit.ts`.
- Scope middleware (`@kevinjohn/adonisjs-access-control/middleware`): named `scope` middleware and
  `scopeMiddleware(options)` resolve the request's membership from `ctx.auth.user` and the route's
  `scopeId`, refuse with `E_ACCESS_CONTROL_FORBIDDEN` otherwise, and set `ctx.membership`.
- `AccessControl.abilities(resolve)`: one Bouncer ability per permission key, resolving the
  membership on every check and denying a missing, suspended or other-subject membership.
- `AccessControl.clientPayload(membership)`: the role, permission keys and assignable roles with a
  string `scopeId`; `null` for no or a suspended membership.
- The provider binds the configured `AccessControl` (alias `access_control`) with the database
  attached and fails at boot when `config/access_control.ts` does not export
  `defineAccessControl(...)`; `services/main` exposes the booted instance.
- `stubsRoot` is computed from the package root, so it is correct from the built package and
  from source regardless of bundler chunking.
- Membership service (`AccessControl.memberships` once a database is attached): `find`,
  `listForUser`, `listForScope` with cursor paging, `add`, `changeRole`, `setStatus`, `remove`,
  `leave`, `transferOwnership`, and the trusted `createFirstMember`, `acceptInvitation`,
  `identityRoles`, `assertCanAdministerIdentity`, `prepareAccountDeletion`, `removeAllForScope`
  and `exportFor`. Every write runs under the lock process (user rows ascending by `String(key)`,
  then the scope row) and reports through `onMembershipChanged` inside the transaction.
- Transaction runner: Account Kit's `transaction` export, which serialises SQLite writers on the
  kit's `account_transaction_lock` row and runs MySQL at READ COMMITTED with a UTC connection.
- `AccessControlError.handle`: the table status, `Cache-Control: no-store` and
  `{ errors: [{ code, message }] }`, translated through `ctx.i18n` when present.
- `docs/reference/errors.md` listing every code.
- `defineAccessControl` with boot validation of roles, permission keys, reserved keys, owner role,
  table names and key types; the frozen `AccessControl` instance exposes the pure rules (`rank`,
  `can`, `permissionsFor`, `assignableRoles`, `canManage`, `canAssign`, `canAdministerIdentity`),
  the public types, `AccessControlError` and the `E_ACCESS_CONTROL_*` code table.
- Scaffold the repository from the sibling package template: toolchain, checks, CI workflows on
  SQLite, PostgreSQL and MySQL, documentation site, maintainer records and the public export
  map with the `configure` hook and `stubsRoot`.
