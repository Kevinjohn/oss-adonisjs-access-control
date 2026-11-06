# Repository conventions

Access Control follows open-source AdonisJS conventions and the shared template of the sibling
packages (`oss-adonisjs-account-kit`, `oss-adonisjs-masquerade`, `oss-adonisjs-lucid-soft-delete`).
The application owns its language, its domain (teams, record-level rules, UI, audit storage) and
its users and scope tables. The package owns memberships, the role matrix and their invariants.
The [build specification](design/spec-access-control.md) is the contract; section 1 there lists
the repository rules this page summarises. Deviating from a rule needs the owner's approval and a
line under [Deviations](#deviations) saying why.

## Distribution

Releases are distributed as GitHub prereleases with a packed tarball. The manually dispatched
`release` workflow calls the reusable `checks` and `compat` workflows, then rejects any release
target outside `main`. Its final gate checks the tag and dated changelog, builds and packs the
package, and creates release notes with an install command and SHA-256 digest. See
[releasing](releasing.md) for the procedure and local dry-run command.

Account Kit is a required peer at an exact version. The dev dependency and the example consumer
install the GitHub release tarball of that version; update the URL, version and peer range
together. `bin/release_check.sh` refuses to release unless the dev dependency is the release
tarball of the exact peer version, so a kit commit or another kit release never ships as the
declared peer.

## Architecture and boundaries

- Roles and permission keys are declared in code (`config/access_control.ts`); nothing about the
  matrix is stored. Memberships (`scope_id`, `user_id`, `role`, `status`) are the only rows the
  package owns.
- Every membership write runs in an Account Kit transaction and follows the lock order in the
  specification (section 4.2): kit user row, kit invitation row, package user rows ascending,
  scope rows ascending, membership rows. Ascending means code-unit order of `String(key)`.
- The reserved permission keys `members:list`, `members:manage` and `invitations:manage` are
  always present; configuration validation refuses a matrix without them.
- Bouncer abilities resolve the request's membership lazily on every check and deny on a missing,
  inactive or other-subject membership.
- Released migration stubs are immutable; schema changes ship as new additive stubs
  (specification section 17.1).
- Error codes are `E_ACCESS_CONTROL_*` with the response shape in specification section 6.
- Files have one responsibility and names describe it. Tests follow source modules; shared
  fixtures live in `tests/helpers/`. Use the [source map](source-map.md) to locate the owner and
  focused tests for a change.

## Toolchain and checks

Use Node 24 and pnpm. Run repository scripts rather than bare tools. `pnpm check` runs
formatting, lint, types, SQLite tests, build and built exports; `pnpm check --full` adds
PostgreSQL, MySQL, coverage, the docs build and the packed SQLite consumer.
`bin/check_profiles.ts` defines the steps. The pull request gate is `pnpm check`, plus
`pnpm test:pg` and `pnpm test:mysql` for changes to database code, locks or migrations; the
`checks` workflow runs all three databases on every pull request.

`pnpm test:consumer` rebuilds and repacks the package before installing it in a copy of
`examples/consumer`, records floor and latest dependency versions from actual package resolution
and exercises SQLite and PostgreSQL consumers; `--package=<path>` skips the rebuild and installs
that tarball as given.

The `c8` block in `package.json` has `check-coverage: true`. Each floor is the lower of the SQLite
and PostgreSQL results at the membership service milestone, rounded down to a whole number and
then lowered by two points so engine-specific branches do not fail a single-engine run:
**FLOORS**. Lowering a floor afterwards is a reviewed change to the config and this paragraph
together.

## SQLite writes

Account Kit's transaction runner (`@kevinjohn/adonisjs-account-kit/transaction`, re-exported by
`src/kit_transaction.ts`) takes SQLite's write lock as the first statement of every transaction by
touching the kit's `account_transaction_lock` row on a dedicated connection with the busy handler
off, retrying in code until its deadline, so the package's writes and the kit's serialise on the
same row. Keep better-sqlite3's default `busy_timeout` (5 seconds) so a commit can wait for
readers.

Do not add Docker support or use npm, npx, yarn or yarn dlx. `better-sqlite3` requires the pinned
Node 24 runtime.

## External PostgreSQL and MySQL

`pnpm test:pg` starts a disposable PostgreSQL 16 cluster through `bin/pg.sh` when the local
binaries are installed. Otherwise provide a disposable server explicitly; the tests create and
remove their own tables, so never point them at a production or shared application database.

```sh
DB_CLIENT=pg DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=postgres \
  DB_PASSWORD=local_test_password DB_DATABASE=package_test pnpm quick:test
```

`pnpm test:mysql` sets `DB_CLIENT=mysql2` and reads the same `DB_*` variables (defaults:
`127.0.0.1:3306`, user `root`, password `root`, database `package_test`, matching the `checks`
workflow service). Replace the example credentials with those of your disposable test server.

## Verification and release evidence

- A test counts as evidence only when it names and asserts the required behaviour. Cite the exact
  test file and case.
- Every new test and every fix is mutation-checked: break the code, see the test go red, restore.
- `tests/docs_links.spec.ts` checks relative paths and anchors. It does not prove the user guide
  content is complete.
- Keep the [requirement ledger](requirement-ledger.md) current. Separate implemented, verified and
  shipped status. A test name is not a pass result; record the command and database outcome
  separately.
- A database that is unavailable locally is reported as CI-only, never as passed.
- Do not publish, tag, merge or rename as part of a task unless separately authorised by the
  owner.

## Public contribution privacy

Use neutral task-focused public content. Do not include private planning metadata, assistant or
provider attribution, tool traces, credentials, or the forbidden standalone word in any
GitHub-visible text. Review complete outgoing content before publication.

## Deviations

- The `luxon` peer range is `^3.4.4`, not the `^3.0.0` in specification section 1.12: Lucid
  `22.4.2`, the Lucid floor, itself requires `luxon ^3.4.4`, so a `3.0.0` floor cannot be
  installed alongside the required Lucid peer. The packed floor consumer installs `luxon 3.4.4`.
  Pending the owner's confirmation.
- `leave` answers `NOT_A_MEMBER`, not `SCOPE_NOT_FOUND`, when the scope row is missing
  (specification section 6 lists `SCOPE_NOT_FOUND` for a missing row during a lock). `leave` is
  routed without the scope middleware, so any signed-in user may call it; one code for a missing
  scope and a missing membership keeps team existence private. Owner-approved on 2026-11-06.
- String keys are locked, stored and compared by the spelling the users or scope row holds, read
  before locking, so a database that compares keys case-insensitively (MySQL's default collation)
  cannot store an alias or reverse the lock order of specification 4.2. Integer and UUID keys
  are canonical after normalisation (5.1) and are not read first. Owner-approved on 2026-11-06.
