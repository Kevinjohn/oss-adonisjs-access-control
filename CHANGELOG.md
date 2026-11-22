# Changelog

## Unreleased

### Added

- Doctor reports memberships with a null or unreadable `created_at` or `updated_at` as
  `invalid_timestamp`. Upgrade note for 0.3.0 and later: reads refuse such rows, so an app-owned
  memberships table with nullable timestamp columns needs its null values backfilled.

### Changed

- Configure's migration-order refusal names the blocking file, says whether a released migration
  is duplicated, sorts before its prerequisite or is followed by an existing file, and points to
  `--migration-path`. A later released migration is published beside the last released migration
  already present, including one in a subdirectory.

## 0.3.1 - 2026-11-22

- Require Account Kit 0.5.1.
- Preserve existing Access Control migrations in Lucid-discoverable subdirectories on reruns.

## 0.3.0 - 2026-11-21

- Require Account Kit 0.5.0.
- Document and verify the package user stories and implementation flows.

- Clarify membership callback transaction ownership and client membership summary route responses.
- Add compatible `defineConfig`, `buildClientMembership`, `getMembership`, `decideManagement`,
  `decideAssignment` and scope middleware aliases.
- Diagnose malformed membership timestamps and statuses during reads and account export.
- Reject service imports before application creation instead of retaining an undefined singleton.
- Honour host configure paths and publish migrations after existing numeric prefixes without
  renaming applied history.
- Bound owner diagnostics to twenty sampled scopes per check and index identity role maps while
  preserving their ordering.

## 0.2.3 - 2026-11-21

### Changed

- Require Account Kit 0.4.2.

## 0.2.2 - 2026-11-20

- Document and test an optional SQLite constraint for one active owner per scope.
- Add a typed active-membership lookup that rejects unconfigured stored roles.
- Have Doctor verify the membership unique pair and restrictive parent references.

## 0.2.1 - 2026-11-19

- Scoped doctor checks resolve equivalent string scope IDs to the stored spelling.
- The Bouncer guide explains why custom authenticators must expose the stored user ID spelling.

### Changed

- Require Account Kit 0.4.1. Its SQLite checkout fix restores compatibility with Lucid 22.5.

## 0.2.0 - 2026-11-16

### Changed

- Requires Account Kit 0.4.0 (exact).
- Adoption guidance identifies when its data-deleting rollback is safe after cutover.

### Fixed

- Release checks refuse failed or malformed archive checksums before writing release notes or
  successful outputs.
- Configure rejects memberships table names longer than 45 characters before writing files, keeping generated index names within PostgreSQL and MySQL limits.
- The doctor reports null roles and statuses in drifted memberships tables.
- Clarified that doctor schema findings take precedence over a malformed scope argument.
- Resume interrupted Account Kit bumps from a checked rewrite plan and preserve scan failures.

- Snapshot consumer archives before inspection and installation, and serialize default builds.

- List the membership, rank and admission checks that single-scope invitation adapters must
  preserve, alongside acceptance transaction requirements.

- Explain replica-backed permission-read consistency and the host choices for primary-backed
  middleware or transactional authorization.

- Document configure source-transform prerequisites and manual provider, command and middleware
  registration when the framework skips those edits.

- State that configure processes must run sequentially for each application.

- Clarify that changing table names or key types in an existing installation needs explicit
  application-owned configuration and schema migration, rather than a configure rerun.

- Explain that the doctor requires a bootable application and resolvable installed peers.

- State the existing-user precondition and database failure behavior of trusted first-member
  bootstrap.

- Document owner bootstrap before trusted grants and explicit recovery choices for an already
  populated ownerless scope.

- Membership documentation separates unauthorised raw reads, manager operations and authenticated
  self-service, including the session-derived identity required when leaving.

- Adoption copy guidance writes Account Kit timestamps so imported members remain visible across cursor pages.
- Membership writes capture mutable role, status and invitation event input before asynchronous work, keeping persisted rows and events aligned.

- String invitation scopes require the stored parent spelling before authorization or acceptance, preserving batch lock order and rollback on an alias.

- PostgreSQL helper locks publish complete owners and preserve replacement owners during stale recovery.
- Process test fixtures wait for complete positive PIDs and capture child output through close.
- Changed-file step timeouts settle after bounded process cleanup, including signaling failures.
- Changed-file docs checks detect content rewritten in an already modified worktree.
- Changed-file reminders include dependency manifests for consumer checks and schema diagnostics for database checks.
- First-member and string-key input guidance now reflects the supported rules.
- Membership reads resolve string key aliases through their parent rows, matching write behavior.
- Cleanup event role types admit historical stored strings; newly assigned role events keep their
  configured role type.
- Resolved configuration types mark copied roles, table settings and permission entries readonly,
  matching the frozen runtime values while caller input stays writable.
- Pure rule successes return independent results, so one caller cannot change another caller's
  later decision.
- Client payload types expose stored historical roles as strings, matching the payload returned
  while a role migration is pending.
- `memberships.add` with the actor as the user answers `E_ACCESS_CONTROL_ALREADY_MEMBER`, as the
  specification says, instead of `E_ACCESS_CONTROL_SELF_MANAGEMENT`.
- `access-control:doctor` exits `2` (the check could not run) when the installed Account Kit
  manifest cannot be read or has no version, instead of reporting a version mismatch. Account Kit
  not being installed is still a mismatch (exit `1`).

## 0.1.8 - 2026-11-14

### Added

- `memberships.authorize({ scopeId, userId, permission, trx })` returns the user's active
  membership when its role holds the permission and throws `E_ACCESS_CONTROL_FORBIDDEN`
  otherwise, inside the caller's transaction.

## 0.1.7 - 2026-11-09

### Changed

- Examples: the API app follows Account Kit's defaults-only example, with integer user IDs and a
  `users` table instead of environment switches for the table and ID type.
- Requires Account Kit 0.3.4 (exact).

## 0.1.6 - 2026-11-08

### Added

- Docs: a getting started guide, a troubleshooting guide, recipes from adopting the package in a
  single-company application (single-scope setup, a shared permission declaration, a per-row
  manage flag, error mapping, stricter product rules, Bouncer inside the request transaction),
  a section on replacing a home-grown access layer, the doctor in CI, and which error codes a user
  can reach. The documentation index follows the shape of the sibling packages.

### Changed

- Requires Account Kit 0.3.3 (exact), the release with `admission.record`.

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
