# @kevinjohn/adonisjs-access-control: build specification

Date: 2026-11-05 (revised after an independent review the same day, section 16; repository rules from the sibling packages in section 1; change over time in section 17). Companion to [`design-access-control.md`](design-access-control.md), which records the
reasoning, prior art and review history. This file is the contract to build from: where the two
disagree, this file wins. It contains no alternatives; every choice here is decided.

Labels: **[repo]** fact read from a repository at the stated revision; **[decided]** a choice made for
this spec; **[prereq]** something that must exist before the milestone that needs it.

---

## 0. Prerequisites

1. **Account Kit #768 merged [prereq for M4].** This spec assumes the shape proposed in the issue
   (https://github.com/Kevinjohn/oss-adonisjs-account-kit/issues/768):
   - `Invitation.scope: string | null`.
   - `authorize.invite(actor, role, context?)` and `authorize.listInvitations(actor, context?)` receive
     `context.scope: string | null` alongside `context.trx`.
   - `authorize.manageInvitation(actor, invitation, context?)` reads `invitation.scope`.
   - `onInvitationAccepted(user, invitation, trx)` runs once per pending invitation for the address,
     in ascending `scope` order (`ORDER BY scope, id`, binary collation), so multi-scope acceptance
     locks scope rows in the same order as every other package operation (4.2).
   - The managed list query filters by the requested scope.

   - The initial context-free `authorize.invite` call on send also receives `{ scope }` (no `trx`).
   - Acceptance fails as a whole if any `onInvitationAccepted` call throws.

   If #768 merges with a different shape, adjust section 9 only.

2. **Account Kit exports its transaction helpers (#769) [prereq for M2] [decided].** Today `transaction()`
   (`src/transaction.ts:271`), `lockRow()` (`src/user_lock.ts:25`) and `sqlTimestamp()`/`readTimestamp()`
   (`src/timestamps.ts`) are internal (not exported from `index.ts`). **[repo]** `oss-adonisjs-account-kit`
   at `01c5138`. Account Kit is a required peer (design D5), so the package reuses them instead of copying
   ~250 lines of SQLite busy-retry, MySQL READ COMMITTED, UTC timestamp and commit-fault handling. Kit
   change: export `transaction(db, callback)`, `lockRow(trx, table, id)`, `sqlTimestamp(trx, dateTime)`
   and `readTimestamp(value)` from `@kevinjohn/adonisjs-account-kit/transaction`, documented as stable. Both runners then share the
   kit's SQLite lock row (`account_transaction_lock`, id 1), so package writes and kit hook writes
   serialise on SQLite.
3. **Account Kit middleware leaves `ctx.auth.user` set (#770) [prereq for M3] [decided].** The kit's
   `admissionMiddleware` and `managedAccountMiddleware` authenticate through
   `ctx.auth.use(name).authenticate()` (`src/http/managed_session_guard.ts:55`), which does not record the
   attempted guard on the Authenticator, so `ctx.auth.user` stays `undefined` (`@adonisjs/auth` 10.1.0
   `Authenticator.get user()`). **[repo]** Kit change: after a successful check, both middlewares make
   `ctx.auth.user` return the authenticated user (e.g. through `ctx.auth.authenticateUsing([name])` or
   equivalent), so app code and the standard Bouncer initializer (`() => ctx.auth.user || null`) see it.
4. **Node 24** (`.nvmrc` `24`), pnpm, AdonisJS 7, Lucid 22, Bouncer 4. **[repo]** matches Account Kit.
5. **Tracking:** Account Kit parent issue #771 tracks #768, #769 (helper exports, 0.2) and #770
   (`ctx.auth.user`, 0.3), and closes only after a release is confirmed.
   https://github.com/Kevinjohn/oss-adonisjs-account-kit/issues/771

---

## 1. Repository rules (strict, from the sibling packages)

The new repository is a sibling of `oss-adonisjs-account-kit`, `oss-adonisjs-masquerade` and
`oss-adonisjs-lucid-soft-delete` and follows their shared template exactly. Where a rule below and
anything else in this spec disagree, this section wins. Deviating from a rule needs the owner's
approval and a line in `docs/maintainers/conventions.md` saying why. **[decided]**

**Template source:** `oss-adonisjs-masquerade` at `74b0c1f` (the closest sibling: an Account Kit
consumer with the full toolchain), with MySQL taken from `oss-adonisjs-lucid-soft-delete` at `960a03e`
and `oss-adonisjs-account-kit` at `01c5138`. **[repo]** Only the files listed in the manifest (1.13)
are taken from the template. "Copy" means: change package names, paths and descriptions only.
"Adapt" means: keep the structure and rules, remove what the manifest says to remove, and add only
what this spec requires. Anything not in the manifest is not brought over.

### 1.1 Identity and distribution

- Repository `Kevinjohn/oss-adonisjs-access-control`; package `@kevinjohn/adonisjs-access-control`;
  version starts at `0.1.0`; MIT (`LICENSE.md`).
- Distributed as GitHub **prereleases** with the packed tarball attached; not on npm. Release notes
  carry the install command and the SHA-256. **[repo]** masquerade `docs/maintainers/releasing.md`.
- README install command and `README-AGENTS.md` pin the exact tarball URL of the current version.

### 1.2 Project principles (copied into `AGENTS.md` and `CONTRIBUTING.md`)

- **Built for everyone who uses AdonisJS.** Follow the open-source AdonisJS packages and starter kits
  for names, shapes and behaviour. Match AdonisJS Plus only where that costs nothing; Plus
  compatibility is not a goal and never outweighs consistency for open-source users.
- **The application owns its language.** Errors carry stable codes and English fallback messages. If
  the request context has `i18n`, the package looks up `errors.<code>` there. The package ships no
  translations, loader, locale detection or language setting. (Replaces "no i18n in v1".)
- **The application owns its domain.** Teams, record-level rules, UI and audit storage belong to the
  app. The package owns memberships, the role matrix and their invariants. (Repository-specific.)

### 1.3 Toolchain

- Node 24 only (`.nvmrc` `24`; `engines.node >=24.0.0`); CI tests Node 24 only. `better-sqlite3` is
  compiled against it.
- pnpm only (`packageManager: pnpm@11.23.0`, `pnpm-workspace.yaml` copied). Never npm, npx, yarn or
  `yarn dlx`.
- **No Docker** support, files or tests. PostgreSQL runs through `bin/pg.sh` (local binaries) or an
  external disposable server via `DB_*` variables; MySQL through `DB_CLIENT=mysql2`.
- Run repository scripts, never the bare tool underneath.
- TypeScript `tsconfig.json` extends `@adonisjs/tsconfig/tsconfig.package.json` (copied).
- Build: `tsdown` then `tsc --emitDeclarationOnly --declaration`; stubs copied into `build/`.
- Prettier: `"prettier": "@adonisjs/prettier-config"`; `.prettierignore`, `.editorconfig`,
  `.gitattributes` copied.
- ESLint: `eslint.config.js` copied, using `configPkg` from `@adonisjs/eslint-config`, with:
  - the `no-restricted-imports` rule for `configProvider` (import it from `@adonisjs/core`; the peer
    floor is Core 7.0.0);
  - `no-restricted-syntax` banning `throw new Error(...)` and `throw new TypeError(...)` in every
    source folder (`src`, `middleware`, `account_kit`, `services`, `providers`): throw a package error
    class, `InvalidArgumentsException` or `RuntimeException`.
- `.gitignore` adapted (including the private-planning block: `PLAN*.md`, `__*.md`, `/plans/`,
  `docs/maintainers/reviews/`, generated API pages and vitepress cache).

### 1.4 `package.json`

- `type: module`, `sideEffects` and `publishConfig` absent, `repository`, `keywords`
  (`adonisjs`, `authorization`, `roles`, `permissions`, `teams`, `bouncer`).
- `files`: `build`, `!build/bin`, `!build/tests`, `README-AGENTS.md`, `SECURITY.md`, `CHANGELOG.md`.
- Scripts, with the same names as the siblings (commands identical unless stated below):
  `typecheck`, `lint`, `format`, `format:check`, `quick:test`, `pretest` (`pnpm lint`), `test`
  (`c8 pnpm quick:test`), `test:built-exports`, `test:consumer`, `test:pg`, `pg:start`, `pg:stop`,
  `test:mysql`, `check`, `check:changed`, `precompile` (`pnpm lint`), `compile`, `postcompile`
  (`pnpm copy:templates`), `build`, `copy:templates`, `docs:api`, `docs:dev`, `docs:build`.
- Dev dependencies use the same ranges as Masquerade where they overlap (e.g. `@adonisjs/core ^7.0.1`,
  `@adonisjs/lucid ^22.4.2`, `@adonisjs/bouncer ^4.0.0`, `@japa/runner ^5.3.0`, `@japa/assert ^4.2.0`,
  `@poppinss/ts-exec ^1.5.1`, `eslint ^10.14.0`, `prettier ^3.8.1`, `tsdown ^0.23.4`,
  `typescript ^5.9.3`, `c8 ^12.0.0`, `better-sqlite3 ^13.0.0`, `pg ^8.0.0`, `typedoc ^0.28.20`,
  `typedoc-plugin-markdown ^4.14.1`, `vitepress ^1.6.4`, `luxon ^3.0.0`, `@types/luxon ^3.0.0`,
  `copyfiles ^2.4.1`, `cross-env ^10.1.0`, `@adonisjs/assembler ^8.6.0`), plus `mysql2 ^3.24.6`.
- Account Kit is a dev dependency by **GitHub release tarball URL**, and the peer is the **exact**
  version of that release (Masquerade pins `"0.2.0"`). **[repo]**
- `typescript` is an optional peer `^5.9.3 || ^6.0.3`.
- `tsdown.entry`: `index.ts`, `configure.ts`, `stubs/main.ts`, `src/types.ts`,
  `providers/access_control_provider.ts`, `services/main.ts`, `middleware/main.ts`,
  `account_kit/main.ts`, `commands/main.ts`. `copy:templates` is Masquerade's
  `copyfiles "stubs/**/*.stub" build`, so `build/stubs/` matches `stubsRoot`.
- `test:mysql` = `cross-env DB_CLIENT=mysql2 pnpm quick:test`; `test:built-exports` =
  `cross-env TEST_BUILT_EXPORTS=1 pnpm quick:test --files=package_exports.spec.ts`.
- `c8` block in `package.json` with `check-coverage: true` and `statements`, `lines`, `branches`,
  `functions` floors. The floors are set at the end of M2 to the lower of the SQLite and PostgreSQL
  results, rounded down, and the derivation is written in `docs/maintainers/conventions.md`. Lowering
  a floor is a reviewed change to both together.

### 1.5 Checks

- `pnpm check` (quick): formatting, lint, types, SQLite tests, build, built exports. `pnpm check --full`
  adds PostgreSQL, MySQL, coverage, docs build and the packed consumer. `bin/check.ts`,
  `bin/check_profiles.ts`, `bin/check_changed.ts`, `bin/check_changed_plan.ts` copied and trimmed to
  this package's profiles.
- **PR gate:** `pnpm check`, plus `pnpm test:pg` and `pnpm test:mysql` for changes to database code,
  locks or migrations. CI runs all three databases on every pull request.
- One Japa config: `files: ['tests/**/*.spec.ts']`, no suites, no `node --test`.
- `tests/package_exports.spec.ts` (built exports) and `tests/docs_links.spec.ts` (links and anchors)
  exist from M0.
- Every new test and every fix is mutation-checked: break the code, see the test go red, restore.
- A test counts as evidence only when it names and asserts the required behaviour.

### 1.6 Files and folders (copied from the sibling `AGENTS.md`)

- **Single responsibility per file**, named for that responsibility; split at a seam, not a line count
  (look at ~800 lines, split at ~1,500); split commits only move code; tests follow the source.
- **Folder layout:** `index.ts` (public entry), `configure.ts`, `providers/<name>_provider.ts`,
  `services/main.ts`, `stubs/`, `src/` (implementation; `src/types.ts` and `src/errors.ts` for public
  types and errors), a top-level folder **only** when it backs a `package.json` export, `bin/` (`.ts`
  via ts-exec; `.sh` allowed), `bin/helpers/`, flat `tests/`, `tests/helpers/`, `tests/fixtures/`,
  `tests/tooling/`, `tests/types/`, `examples/`, `docs/`. No `scripts/` folder.
- TypeScript files and folders are `snake_case`; Markdown under `docs/` is kebab-case, as in the
  siblings.

### 1.7 Exports and source layout (replaces the earlier tables)

| Subpath                     | File                                   | Contents                                                                                                                                                                       |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.`                         | `index.ts`                             | `defineAccessControl`, `AccessControl`, errors, `configure` (from `configure.ts`) and `stubsRoot` (from `stubs/main.ts`); `node ace configure` reads both from the root export |
| `./types`                   | `src/types.ts`                         | type-only public types (`Role`, `PermissionKeyOf`, `ClientPayload`, …)                                                                                                         |
| `./access_control_provider` | `providers/access_control_provider.ts` | service provider (sibling naming: `./account_kit_provider`, `./masquerade_provider`)                                                                                           |
| `./services/main`           | `services/main.ts`                     | container-resolved `AccessControl` singleton                                                                                                                                   |
| `./middleware`              | `middleware/main.ts`                   | default export `ScopeMiddleware` class; `scopeMiddleware(options)`                                                                                                             |
| `./account-kit`             | `account_kit/main.ts`                  | `accessControlKitCallbacks` (Masquerade's subpath name)                                                                                                                        |
| `./commands`                | `commands/main.ts`                     | Ace commands: `access-control:doctor` (17.2)                                                                                                                                   |

```
index.ts
configure.ts
providers/access_control_provider.ts
services/main.ts
middleware/main.ts             scope middleware (exported subpath)
account_kit/main.ts            Account Kit callbacks (exported subpath)
src/types.ts                   public types
src/errors.ts                  AccessControlError and codes
src/define.ts                  defineAccessControl and config validation
src/rules.ts                   pure rules
src/memberships.ts             membership service
src/locks.ts                   lock process
src/pagination.ts              cursor encode/decode
src/abilities.ts               Bouncer ability factory
src/payload.ts                 client payload
stubs/main.ts                  export const stubsRoot = import.meta.dirname
stubs/config.stub
stubs/migrations/access_control_create_memberships.stub
bin/                           check, pg.sh, release_check.sh, test.ts, test_consumer.ts
tests/                         flat specs; tests/helpers/ shared fixtures
examples/consumer/             packed-consumer app used by test:consumer
docs/
```

### 1.8 Repository files

Copied and adapted: `AGENTS.md` (Node version, project principles, checks, SRP rules, folder layout,
repository-specific), `CLAUDE.md` (exactly `@AGENTS.md`), `README-AGENTS.md` (fit check,
requirements, install, capabilities, invariants, testing, source map, further reading, tested-against
table; shipped in the package), `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
`CHANGELOG.md` (starts with `## Unreleased`), `README.md` with a **Tested against** table that mirrors
`checks.yml` and `compat.yml` (change them in the same PR).

`.github/`: `FUNDING.yml`, `ISSUE_TEMPLATE/` (`bug_report.yml`, `feature_request.yml`, `config.yml`),
`pull_request_template.md` (What changes / Why / Checks checklist, adding `pnpm test:mysql`),
`dependabot.yml` (weekly grouped npm **patch** updates only; minor, major and Actions by hand),
workflows `checks`, `codeql`, `compat`, `docs`, `release`, `scorecard` (no `examples` workflow in
v1; the packed consumer runs in the `compat` workflow's `consumer` job and locally in
`pnpm check --full`; `checks.yml` runs the individual scripts as the siblings do). The `release` workflow is manually
dispatched on `main`, calls the reusable `checks` and `compat` workflows, checks the tag and dated
changelog, packs, and publishes the prerelease with the SHA-256.
`bin/release_check.sh` runs the same gate locally.

### 1.9 Documentation layout

- `docs/guide/` (user guides, section 14), `docs/recipes/`, `docs/reference/` (`README.md`, generated
  `api/` via typedoc, `errors.md`), `docs/maintainers/` (`README.md`, `conventions.md`,
  `source-map.md`, `verification.md`, `releasing.md`, `requirement-ledger.md`, `design/`). Built with
  vitepress; the `docs` workflow builds it on pull requests.
- **This spec moves into the repository** as `docs/maintainers/design/spec-access-control.md` in M0
  (Masquerade keeps its contract at `docs/maintainers/design/spec-masquerade.md`). From then on the
  repository copy is authoritative.
- `docs/maintainers/requirement-ledger.md` maps each requirement to its test file and case, keeping
  implemented, verified and shipped status separate.
- Private working plans go in the gitignored `plans/` directory, never committed.

### 1.10 Pull requests, commits and public text

- One focused change per pull request; a bug fix includes a test that fails without it.
- User-visible changes update docs and add a line under `## Unreleased` in `CHANGELOG.md`.
- Public error codes are stable; changing one needs a breaking changelog entry.
- Imperative commit messages, signed off (`git commit -s`). Work in a branch and worktree, never on
  `main`; pull requests stay open until the owner authorises the merge.
- **Public contribution privacy:** no private planning metadata, assistant or provider attribution,
  tool traces or credentials, and not the word the sibling repositories forbid, in any GitHub-visible
  text. Review outgoing text before publishing.
- Do not publish, tag, merge or rename as part of a task unless the owner authorises it.

### 1.11 Releasing (copied from the siblings)

1. On a branch: bump `version`, turn `## Unreleased` into `## <version> - <YYYY-MM-DD>` with a new
   empty `## Unreleased` above, update the README and `README-AGENTS.md` install commands to the exact
   version. When the pinned Account Kit archive changes, update its URL, version and checksum together.
2. Merge the PR (owner-authorised).
3. Actions → release → Run workflow on `main`.

### 1.12 Peer dependencies

| Package                           | Range                                                             | Optional |
| --------------------------------- | ----------------------------------------------------------------- | -------- |
| `@adonisjs/core`                  | `^7.0.0`                                                          | no       |
| `@adonisjs/lucid`                 | `^22.4.2`                                                         | no       |
| `@adonisjs/bouncer`               | `^4.0.0`                                                          | no       |
| `@adonisjs/auth`                  | `^10.0.0`                                                         | no       |
| `luxon`                           | `^3.0.0`                                                          | no       |
| `@kevinjohn/adonisjs-account-kit` | exact version of the first release containing #768, #769 and #770 | no       |
| `typescript`                      | `^5.9.3 \|\| ^6.0.3`                                              | yes      |

### 1.13 Template manifest

From `oss-adonisjs-masquerade` at `74b0c1f` unless noted. **[repo]**

| Action       | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copy         | `.editorconfig`, `.gitattributes`, `.nvmrc`, `tsconfig.json`, `pnpm-workspace.yaml`, `LICENSE.md`, `CODE_OF_CONDUCT.md`, `CLAUDE.md`, `.github/FUNDING.yml`, `.github/ISSUE_TEMPLATE/*`, `.github/dependabot.yml`, `.github/workflows/codeql.yml`, `.github/workflows/scorecard.yml`, `bin/pg.sh`, `bin/release_check.sh`, `tests/helpers/tracked_markdown.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Adapt        | `.gitignore` and `.prettierignore` (keep the common and private-planning blocks; drop each repository-specific block), `typedoc.json` (entry points per 1.7; empty `intentionallyNotExported`; keep `treatWarningsAsErrors`), `tests/docs_links.spec.ts` (assert this package's pages from sections 14 and 17), `docs/.vitepress/config.mts`, `navigation.mts`, `github_links.mts` (title, base `/oss-adonisjs-access-control/`, sidebar per 1.9 and 14), `docs/README.md`, `docs/reference/README.md`, `docs/recipes/index.md`, `bin/helpers/consumer_artifact.ts`, `bin/helpers/consumer_process.ts`, `bin/helpers/registry_version.ts` (used by `bin/test_consumer.ts`), `eslint.config.js` (file globs per 1.3), `package.json` (1.4), `AGENTS.md`, `CONTRIBUTING.md`, `README-AGENTS.md`, `SECURITY.md`, `README.md` (structure only), `.github/pull_request_template.md` (add `pnpm test:mysql`), `.github/workflows/checks.yml` (database matrix `better-sqlite3`, `pg`, `mysql2`, taking the MySQL service block from `oss-adonisjs-lucid-soft-delete` at `960a03e`), `.github/workflows/compat.yml` (floor and latest of this package's peers, SQLite and PostgreSQL consumers; drop browser and Account Kit demo cells), `.github/workflows/docs.yml`, `.github/workflows/release.yml` (drop the `examples` call), `bin/test.ts`, `bin/test_consumer.ts` (fixture `examples/consumer/`; drop the optional-Account-Kit root probe, because the kit is a required peer; check `config/access_control.ts`), `bin/check.ts`, `bin/check_profiles.ts`, `bin/check_changed.ts`, `bin/check_changed_plan.ts` (profiles: quick and full only; no browser profile), `tests/package_exports.spec.ts`, `docs/maintainers/README.md`, `conventions.md`, `releasing.md`, `verification.md` |
| New          | everything in 1.7 (including `stubs/main.ts`), `tests/helpers/schema.ts` (4.3), `examples/consumer/` (minimal AdonisJS 7 app with Account Kit used by `test:consumer`), `docs/maintainers/source-map.md`, `requirement-ledger.md`, `design/spec-access-control.md` (this file), `CHANGELOG.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Do not bring | `examples/account-kit`, `account-kit-demo`, `inertia-react`, `inertia-vue`, `native-session`, `recipe-host`; `.github/workflows/examples.yml`; `bin/demo*.ts`, `bin/test_account_kit*.ts`, `bin/test_inertia_*.ts`, `bin/test_recipe.ts`, `bin/measure_expiry_scan.ts`, `bin/helpers/account_kit_demo_*`, `bin/helpers/postgres_measurement.ts`, `bin/helpers/prepare_account_kit_demo.ts`, `bin/helpers/account_kit_host_wiring.ts`; every Masquerade source folder (`auth/`, `http/`, `native/`, `stores/`, `testing/`, `plugins/`, `account_kit/`, `src/`, `commands/`, `stubs/`); every Masquerade spec except the two copied above; `docs/maintainers/adoption-validation/`, `alpha-baseline.md`, `expiry-scan-measurement.md`, `design/` contents; Masquerade guides and recipes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

`pnpm test:recipe` and a browser profile are out of scope for v1.

---

## 2. Configuration

### 2.1 Shape

```ts
// config/access_control.ts
import { defineAccessControl } from '@kevinjohn/adonisjs-access-control'

export default defineAccessControl({
  roles: ['viewer', 'editor', 'admin', 'owner'],
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  permissions: {
    project: { read: 'viewer', write: 'editor', archive: 'admin' },
    members: { list: 'admin', manage: 'admin' },
    invitations: { manage: 'admin' },
  },
  onMembershipChanged: async (event, trx) => {},
})
```

### 2.2 Types

```ts
export type KeyType = 'integer' | 'string' | 'uuid' // same set as Account Kit's --user-id-type

export function defineAccessControl<
  const R extends readonly [string, ...string[]],
  const P extends PermissionMap<R[number]>,
>(config: AccessControlConfig<R, P>): AccessControl<R, P>
// `const` type parameters are required: without them roles infer as string[] and the compile-time
// key checks disappear. The returned instance carries R and P for RoleOf / PermissionKeyOf.

export interface AccessControlConfig<
  R extends readonly [string, ...string[]],
  P extends PermissionMap<R[number]>,
> {
  /** Lowest rank first. Rank is the index. */
  roles: R
  /** Optional. Must be the last (highest) role when set. Enables owner rules. */
  ownerRole?: R[number]
  /** The app's users table and key type (must match Account Kit's). */
  users: { table: string; keyType: KeyType }
  /** The app's scope (team) table and key type. */
  scope: { table: string; keyType: KeyType }
  /** Memberships table name. Default 'memberships'. Set it when the app already has that table. */
  membershipsTable?: string
  /** resource -> action -> lowest role allowed. Must include the reserved keys. */
  permissions: P
  /**
   * Runs inside every membership write transaction, after the write. Throwing rolls back.
   * It must not lock or write other users' rows or Account Kit tables, which sit earlier in the
   * lock order (4.2); writing app tables is fine.
   */
  onMembershipChanged?: (event: MembershipEvent<R[number]>, trx: Trx) => Promise<void>
}

export type PermissionMap<Role extends string> = Record<string, Record<string, Role>> & {
  members: { list: Role; manage: Role } & Record<string, Role>
  invitations: { manage: Role } & Record<string, Role>
}

/** 'project:read' | 'project:write' | ... derived from the permission map. */
export type PermissionKeyOf<P> = {
  [Res in keyof P & string]: `${Res}:${keyof P[Res] & string}`
}[keyof P & string]
```

- **Permission keys use a colon: `resource:action` [decided].** The Bouncer test build showed Edge's
  `@can('project.write')` splits on `.` and looks up a `project` policy, throwing
  `Invalid bouncer policy "'project'"`; `project:write` works in Edge, `allows` and `authorize`.
  (Spike, section 13.)
- Resource and action names: `^[a-z][a-zA-Z0-9]*$`. Role names: `^[a-z][a-z0-9_-]*$`, at most 32
  characters.

### 2.3 Boot validation

`defineAccessControl` throws `AccessControlError` with code `E_ACCESS_CONTROL_INVALID_CONFIG` (status
500; the message names the problem; never a bare `Error`, per 1.3) when:

1. `roles` is empty or has duplicates, or a role name fails the pattern.
2. A permission value is not in `roles`.
3. A resource or action name fails the pattern.
4. `members.list`, `members.manage` or `invitations.manage` is missing.
5. `ownerRole` is set and either is not the last role or `roles.length < 2`.
6. `users.table`, `scope.table` or `membershipsTable` is not a plain SQL identifier (`^[A-Za-z_][A-Za-z0-9_]*$`), or a
   `keyType` is not `integer | string | uuid`.

The returned object is frozen.

### 2.4 Deployment contract (documented in `docs/guide/roles.md`)

Renaming or removing a role, or changing `ownerRole`, requires a migration that rewrites the
configured memberships table's `role` and pending `account_invitations.role` rows. Boot does not scan the database.
A stored role that is no longer in the tuple is treated as unknown: every check denies.

---

## 3. Pure rules (`src/rules.ts`)

No AdonisJS imports. Exposed on the `AccessControl` instance.

```ts
rank(role: string): number            // -1 when unknown
can(role: string, key: string): boolean
permissionsFor(role: string): PermissionKey[]
assignableRoles(actorRole: string): Role[]
canManage(input: { actorRole: string; targetRole: string; isSelf: boolean }): RuleResult
canAssign(input: { actorRole: string; targetRole: string; nextRole: string; isSelf: boolean }): RuleResult
canAdministerIdentity(actorRoles: ReadonlyMap<ScopeKey, string>, targetRoles: ReadonlyMap<ScopeKey, string>, isSelf: boolean): boolean

type RuleResult = { allowed: true } | { allowed: false; code: AccessControlErrorCode }
```

Definitions (`O` = owner role, `M(k)` = minimum role for key `k`):

- `can(role, key)`: `rank(role) >= 0 && key known && rank(role) >= rank(M(key))`.
- `assignableRoles(actorRole)`: if `!can(actorRole, 'members:manage')` then `[]`; else every role with
  `rank <= rank(actorRole)`, excluding `O`.

### 3.1 Management truth table (`canManage`: change role target, change status, remove)

Evaluated in order; first match wins.

| #   | Condition                            | Result                 |
| --- | ------------------------------------ | ---------------------- |
| 1   | actor or target role unknown         | deny `UNKNOWN_ROLE`    |
| 2   | `isSelf`                             | deny `SELF_MANAGEMENT` |
| 3   | `!can(actorRole, 'members:manage')`  | deny `FORBIDDEN`       |
| 4   | `O` set and `targetRole === O`       | deny `OWNER_PROTECTED` |
| 5   | `rank(targetRole) > rank(actorRole)` | deny `RANK_TOO_LOW`    |
| 6   | otherwise                            | allow                  |

Equal rank is allowed (an admin may manage another admin).

### 3.2 Assignment (`canAssign`)

`canManage` first; then, in order:

| #   | Condition                          | Result                 |
| --- | ---------------------------------- | ---------------------- |
| 1   | `nextRole` unknown                 | deny `UNKNOWN_ROLE`    |
| 2   | `O` set and `nextRole === O`       | deny `OWNER_PROTECTED` |
| 3   | `rank(nextRole) > rank(actorRole)` | deny `RANK_TOO_LOW`    |
| 4   | otherwise                          | allow                  |

`add` uses `canAssign` with `targetRole = nextRole` and `isSelf = false`, skipping `canManage` rows
2, 4 and 5 (there is no existing target).

### 3.3 Self operations

- Own role change and own status change: always `SELF_MANAGEMENT` (row 2).
- Leaving (`leave`): allowed for any non-owner; an owner gets `OWNER_PROTECTED`.
- No last-manager protection when `O` is unset. Documented in `docs/guide/rules.md`.

### 3.4 Identity predicate (`canAdministerIdentity`)

For password reset, session revocation and similar actions by one user on another.

1. `targetRoles.size === 0` → false.
2. `isSelf` → true.
3. For every `(scope, targetRole)` in `targetRoles`: actor must have an entry in `actorRoles` for that
   scope, and `canManage({ actorRole, targetRole, isSelf: false })` must allow. Any failure → false.
   (A target who is an owner anywhere can therefore only be administered by themselves.)
4. Otherwise true.

`actorRoles` contains the actor's **active** memberships; `targetRoles` contains **all** the target's
memberships, including suspended. Loading is done by `memberships.identityRoles(actorId, targetId,
trx)` (section 5.3).

---

## 4. Database

### 4.1 Migration stub (`stubs/migrations/access_control_create_memberships.stub`)

Placeholders filled by `configure`: `{{ membershipsTable }}`, `{{ usersTable }}`, `{{ userKeyType }}`,
`{{ scopeTable }}`, `{{ scopeKeyType }}`.

```ts
export default class extends BaseSchema {
  protected tableName = '{{ membershipsTable }}'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      // keyType mapping, identical to Account Kit's configure.ts:193-198:
      //   'integer' -> integer().unsigned()   'uuid' -> uuid()   'string' -> string(254)
      // bigInteger would break the MySQL foreign key against an increments() parent.
      table.<scopeKey>('scope_id').notNullable()
        .references('id').inTable('{{ scopeTable }}').onDelete('RESTRICT')
      table.<userKey>('user_id').notNullable()
        .references('id').inTable('{{ usersTable }}').onDelete('RESTRICT')
      table.string('role', 32).notNullable()
      table.string('status', 16).notNullable().defaultTo('active')
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.unique(['scope_id', 'user_id'], { indexName: '{{ membershipsTable }}_scope_user_unique' })
      table.index(['user_id'], '{{ membershipsTable }}_user_index')
      table.index(['scope_id', 'created_at', 'id'], '{{ membershipsTable }}_scope_page_index')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
```

- Table name defaults to `memberships` and is configurable (`membershipsTable`, `--memberships-table`),
  because apps may already have a `memberships` table; CapacityLens does. **[repo]** Column names are
  fixed. Adopting the package over an existing membership table is a documented app migration
  (`docs/guide/adopting.md`): create the package table, copy rows mapping the app's team column to
  `scope_id`, then switch. The scope and users tables must have an `id` primary key (the kit already requires this for users). **[repo]** `src/user_lock.ts:17`.
- **Foreign keys are `RESTRICT`, not `CASCADE` [decided].** A cascade would delete memberships without
  `onMembershipChanged` firing, leaving the app's audit trail incomplete. Apps remove memberships
  through the package first (5.4, 5.5); forgetting fails loudly with a foreign-key error instead of
  silently losing history.
- No database-specific owner index. One active owner per scope is enforced by the lock process in 4.2
  on every database (owner ruling: "We code for process, not DB choice").
- Timestamps are written in UTC through Luxon, matching the kit.

### 4.2 Lock process

Every operation that checks an invariant runs inside a kit `transaction()` (or a caller `trx` started by
it) and, before reading memberships:

1. **Locks user rows**: `lockRow(trx, config.users.table, id)` for the target user and, when there is
   one, the actor, in ascending key order. Every membership write locks its target user's row, so a
   user's set of memberships cannot change while that row is held.
2. **Locks the scope row**: `lockRow(trx, config.scope.table, scopeId)`, then on every database
   `trx.from(config.scope.table).select('id').where('id', scopeId).first()`; `undefined` →
   `SCOPE_NOT_FOUND`. (`lockRow` returns nothing and is a no-op on SQLite, where the kit runner already
   holds the writer lock.)
3. Re-reads the memberships it needs through `trx`.
4. Checks, writes, calls `onMembershipChanged`, returns.

**Lock order [decided]:** kit user row (inviter, managing actor or deleting user) → kit invitation
row → package user rows (ascending) → scope rows (ascending) → membership rows. **[repo]** kit
`src/invitations.ts:173-175` ("Lock order: inviter, invitation, then whatever the application locks"),
`src/account_deletion.ts:22-31`. Re-locking a row already held in the same transaction is safe.

**Ascending** means code-unit order of `String(key)` for every multi-row lock sequence in this
package, for every key type (so integer keys sort as strings: `'10'` before `'9'`). This matches the
order #768 uses when it calls `onInvitationAccepted` per invitation (section 0).
Operations spanning several scopes (identity checks, account deletion) hold the user rows first, which
freezes those users' membership sets, then lock the scope rows they read, ascending.

`onMembershipChanged` runs after step 4's write, while these locks are held; it must not lock or write
other users' rows or Account Kit tables, which sit earlier in the lock order.

On SQLite, where `lockRow` is a no-op and the kit runner holds the writer lock from its first
statement, a cross-user membership write inside `authentication.withCurrent` with that callback's
`trx` is tested in the packed consumer (one process, one database file, one-connection pool); the
lock order above is unchanged.

### 4.3 Transactions

- Every service method takes `trx?: Trx`. Without it, the method runs `transaction(db, fn)` from the
  kit. With it, the caller must have started `trx` through the kit's `transaction()` (or be inside a
  kit hook, which already does). Documented; not detectable at runtime.
- Tests and `examples/consumer` create, on every database, the kit's `account_transaction_lock` table
  (row id 1, version 0, from the kit's stub), a users table and a scope table with `id` primary keys
  for each key type under test (`tests/helpers/schema.ts`). The kit runner throws without the lock row.
- No method retries; the kit runner owns SQLite busy retries. Committed work is never replayed.
- Network, mail and other side effects are never performed inside these transactions.
- The tested SQLite exception: a caller `trx` from `authentication.withCurrent` may carry
  cross-user membership writes in the configuration of section 4.2; the package still locks in the
  section 4.2 order and leaves commit and rollback to the caller.

---

## 5. Membership service (`src/memberships.ts`)

Resolved from the container as `AccessControl` (`app.container.make(AccessControl)`); exposes
`memberships` plus the pure rules.

### 5.1 Types

```ts
export type ScopeKey = number | string
export type UserKey = number | string
export type MembershipStatus = 'active' | 'suspended'

export interface Membership {
  scopeId: ScopeKey
  userId: UserKey
  role: string
  status: MembershipStatus
  createdAt: DateTime
  updatedAt: DateTime
}

export interface Actor {
  id: UserKey
}

export type MembershipEvent<Role extends string> =
  | { type: 'membership.added'; scopeId: ScopeKey; userId: UserKey; actorId: UserKey; role: Role }
  | { type: 'membership.first_member'; scopeId: ScopeKey; userId: UserKey; role: Role }
  | {
      type: 'membership.invitation_accepted'
      scopeId: ScopeKey
      userId: UserKey
      role: Role
      invitationId: number
    }
  | {
      type: 'membership.role_changed'
      scopeId: ScopeKey
      userId: UserKey
      actorId: UserKey
      from: Role
      to: Role
    }
  | {
      type: 'membership.status_changed'
      scopeId: ScopeKey
      userId: UserKey
      actorId: UserKey
      from: MembershipStatus
      to: MembershipStatus
    }
  | {
      type: 'membership.removed'
      scopeId: ScopeKey
      userId: UserKey
      actorId: UserKey | null
      role: Role
      reason: 'removed' | 'scope_deleted' | 'account_deleted'
    }
  | { type: 'membership.left'; scopeId: ScopeKey; userId: UserKey; role: Role }
  | {
      type: 'membership.ownership_transferred'
      scopeId: ScopeKey
      fromUserId: UserKey
      toUserId: UserKey
      demotedTo: Role
    }

export interface MembershipPage {
  items: Membership[]
  nextCursor: string | null
}
```

Keys are normalised on read: `keyType: 'integer'` → JS number (throw `INVALID_INPUT` if not a safe
positive integer); `'uuid'` → lower-case string matching the UUID pattern (else `INVALID_INPUT`);
`'string'` → string of 1-254 characters. Comparisons use the normalised value.

### 5.2 Ordinary operations (actor-authorized)

For each write (`add`, `changeRole`, `setStatus`, `remove`, `leave`, `transferOwnership`; the three
reads below do not lock): run in a transaction (4.3) → locks (4.2) → load the actor's membership in that scope
through `trx`; missing or suspended → `FORBIDDEN` → apply `canManage`/`canAssign` rows that depend only
on the actor (unknown actor role, `members:manage`) → only then check the target's existence (so a
non-manager cannot probe membership by 404 versus 403) → remaining rule rows → write → event → return.

| Method              | Input                                       | Rule                                                                                                                                                                           | Result                                     | Event                                                         |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------- |
| `find`              | `scopeId, userId, trx?`                     | none (no lock, plain read)                                                                                                                                                     | `Membership \| null`                       | none                                                          |
| `listForUser`       | `userId, trx?`                              | none (no lock)                                                                                                                                                                 | `Membership[]` ordered by `created_at, id` | none                                                          |
| `listForScope`      | `{ actor, scopeId, cursor?, limit?, trx? }` | actor `can('members:list')`                                                                                                                                                    | `MembershipPage`                           | none                                                          |
| `add`               | `{ actor, scopeId, userId, role, trx? }`    | `canAssign` (3.2); after locking, `trx.from(users.table).select('id').where('id', userId).first()` is `undefined` → `USER_NOT_FOUND`; already a member → `ALREADY_MEMBER`      | `Membership`                               | `membership.added`                                            |
| `changeRole`        | `{ actor, scopeId, userId, role, trx? }`    | target must exist (`NOT_A_MEMBER`); `canAssign`                                                                                                                                | `Membership`                               | `membership.role_changed` (skip write and event if unchanged) |
| `setStatus`         | `{ actor, scopeId, userId, status, trx? }`  | target exists; `canManage`                                                                                                                                                     | `Membership`                               | `membership.status_changed` (skip if unchanged)               |
| `remove`            | `{ actor, scopeId, userId, trx? }`          | target exists; `canManage`                                                                                                                                                     | `void`                                     | `membership.removed` (`reason: 'removed'`)                    |
| `leave`             | `{ scopeId, userId, trx? }`                 | member exists; owner → `OWNER_PROTECTED`                                                                                                                                       | `void`                                     | `membership.left`                                             |
| `transferOwnership` | `{ actor, scopeId, toUserId, trx? }`        | `O` unset → `OWNER_DISABLED`; actor not the active `O` → `FORBIDDEN`; target is actor → `SELF_MANAGEMENT`; target missing → `NOT_A_MEMBER`; target suspended → `INVALID_INPUT` | `void`                                     | `membership.ownership_transferred`                            |

- `listForScope`: `limit` default 25, max 100; ordered by `created_at asc, id asc`; cursor is
  base64url JSON `[createdAt, id]` like the kit's invitation cursor **[repo]**
  `src/invitation_cursor.ts:11`. Timestamps go through the kit's `sqlTimestamp`/`readTimestamp`.
  `listForScope` does not lock.
- `leave` does not require the leaving member to be active; a suspended member may leave. Route `leave`
  without the scope middleware, which refuses suspended members.
- `transferOwnership` demotes the old owner to `roles[roles.length - 2]` (highest non-owner) and sets
  the new owner's role to `O`, in the same transaction.

### 5.3 Trusted operations (no actor)

| Method                        | Input                                                         | Checks                                                                                                                                                                                                                         | Event                            |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `createFirstMember`           | `{ scopeId, userId, role?, trx? }`                            | scope locked; any membership exists → `SCOPE_NOT_EMPTY`. When `O` set: role is `O` (passing another role → `INVALID_INPUT`). When unset: `role` required and must satisfy `can(role, 'members:manage')`, else `INVALID_INPUT`. | `membership.first_member`        |
| `acceptInvitation`            | `{ scopeId, userId, role, invitationId, trx }` (trx required) | scope locked; role known and not `O` else `INVALID_INPUT`; existing membership → `ALREADY_MEMBER`                                                                                                                              | `membership.invitation_accepted` |
| `identityRoles`               | `{ actorId, targetId, trx? }`                                 | locks both user rows ascending (freezing both membership sets), reads memberships, locks the scope rows of both maps' union, ascending; returns `{ actorRoles, targetRoles }` per 3.4                                          | none                             |
| `assertCanAdministerIdentity` | `{ actorId, targetId, trx? }`                                 | `identityRoles` then `canAdministerIdentity`; false → `FORBIDDEN`                                                                                                                                                              | none                             |

These are server-only. They are on the service but documented as "do not expose to request input
without your own checks".

`assertCanAdministerIdentity` runs in its own transaction immediately **before** the Account Kit
operation it guards (password reset request, session revocation). Kit operations open their own
transactions and may send mail, so they cannot run inside the package's. The guarantee covers the
check only, not the gap between check and kit operation; this is documented.

### 5.4 Account deletion support

`memberships.prepareAccountDeletion({ userId, trx })`, called by the kit's deleting hook:

1. The user row is already locked by the kit; read the user's memberships through `trx`.
2. Lock those scope rows ascending.
3. If the user is the active `O` of any scope → `LAST_OWNER`.
4. Otherwise delete every membership of the user, emitting `membership.removed` with
   `actorId: null, reason: 'account_deleted'` for each, so the kit's user delete then passes the
   `RESTRICT` foreign key.

### 5.5 Scope deletion support

`memberships.removeAllForScope({ scopeId, actor?, trx })`, which the app calls in the same transaction
immediately before deleting its scope row:

1. Keep the lock order (users before scopes): read the scope's member ids without locking, lock
   those user rows ascending, lock the scope row, then re-read the members through `trx`. If the
   member set differs, throw `E_ACCESS_CONTROL_CONFLICT` (409) without locking any further rows; the
   app retries the whole transaction.
2. Delete every membership, emitting `membership.removed` with `reason: 'scope_deleted'` and
   `actorId` from `actor` (or null).
3. Authorization of who may delete a team is the app's; the package does not check it.

### 5.6 Export support

`memberships.exportFor({ userId, trx })` returns
`{ memberships: Array<{ scopeId; role; status; createdAt: string; updatedAt: string }> }` with ISO
timestamps.

---

## 6. Errors (`src/errors.ts`)

```ts
import { Exception } from '@adonisjs/core/exceptions'

export class AccessControlError extends Exception {
  // `code` is one of the codes below; `status` and the default message come from the table.
}
```

Codes follow Account Kit's `E_ACCOUNT_KIT_*` convention. **[repo]** `src/errors.ts`.

| Code                               | HTTP | Message                                                                                 | Thrown when                                                                             |
| ---------------------------------- | ---- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `E_ACCESS_CONTROL_FORBIDDEN`       | 403  | You do not have permission to do that.                                                  | actor lacks membership, is suspended, lacks the key, or is not the owner for a transfer |
| `E_ACCESS_CONTROL_NOT_A_MEMBER`    | 404  | That person is not a member of this team.                                               | target membership missing                                                               |
| `E_ACCESS_CONTROL_USER_NOT_FOUND`  | 404  | That person does not exist.                                                             | `add` for a missing users row                                                           |
| `E_ACCESS_CONTROL_ALREADY_MEMBER`  | 409  | That person is already a member of this team.                                           | add or accept on an existing membership                                                 |
| `E_ACCESS_CONTROL_UNKNOWN_ROLE`    | 422  | That role does not exist.                                                               | a role outside the tuple                                                                |
| `E_ACCESS_CONTROL_RANK_TOO_LOW`    | 403  | You cannot manage someone with a higher role.                                           | rank rules                                                                              |
| `E_ACCESS_CONTROL_OWNER_PROTECTED` | 409  | The owner cannot be changed, suspended or removed except through an ownership transfer. | owner targeted, assigned, or leaving                                                    |
| `E_ACCESS_CONTROL_SELF_MANAGEMENT` | 409  | You cannot change your own role or status.                                              | self role or status change; transfer to self                                            |
| `E_ACCESS_CONTROL_OWNER_DISABLED`  | 409  | This application has no owner role.                                                     | transfer without `ownerRole`                                                            |
| `E_ACCESS_CONTROL_LAST_OWNER`      | 409  | Transfer ownership before deleting this account.                                        | account deletion while owner                                                            |
| `E_ACCESS_CONTROL_SCOPE_NOT_EMPTY` | 409  | This team already has members.                                                          | `createFirstMember` on a non-empty scope                                                |
| `E_ACCESS_CONTROL_SCOPE_NOT_FOUND` | 404  | That team does not exist.                                                               | scope row missing during lock                                                           |
| `E_ACCESS_CONTROL_INVALID_INPUT`   | 422  | The request is not valid.                                                               | malformed keys, bad trusted-op input, transfer to a suspended member                    |

| `E_ACCESS_CONTROL_INVALID_CONFIG` | 500 | (names the problem) | boot validation (2.3) |
| `E_ACCESS_CONTROL_CONFLICT` | 409 | The team changed while it was being deleted. Try again. | `removeAllForScope`: the member set changed between read and lock |

Elsewhere in this spec, codes are written without the `E_ACCESS_CONTROL_` prefix for brevity. The
scope middleware's refusals use `FORBIDDEN`.

**Language (1.2):** `AccessControlError` implements `handle(error, ctx)`: the message is
`ctx.i18n.t('errors.<code>', {}, <English message>)` when `ctx.i18n` exists, otherwise the English
message. It sets the table's status and `Cache-Control: no-store`, then
`ctx.response.json({ errors: [{ code, message }] })` (Masquerade's shape; no content negotiation). The
package ships no translations. `docs/reference/errors.md` lists every code with its English message.

## 7. Scope middleware (`./middleware`)

```ts
export interface ScopeMiddlewareOptions {
  /** Default: (ctx) => ctx.params.scopeId */
  resolveScope?: (ctx: HttpContext) => unknown
}

/** Default export, registered as named middleware `scope`: `middleware.scope()` in routes. */
export default class ScopeMiddleware {
  handle(ctx: HttpContext, next: NextFn, options?: ScopeMiddlewareOptions): Promise<unknown>
}

/** Same behaviour for `.use(scopeMiddleware(options))`. */
export function scopeMiddleware(
  options?: ScopeMiddlewareOptions
): (ctx: HttpContext, next: NextFn) => Promise<unknown>
```

- Runs after Account Kit's `admissionMiddleware` (admission enabled) or `managedAccountMiddleware`
  (admission disabled). **[repo]** `src/admission/middleware.ts:10-21` checks guard, credential
  revision, active account and admission; `src/http/managed_account_middleware.ts:6-18` checks guard,
  revision and active. Registered as named middleware `scope`; applied per route or route group,
  never globally.
- Reads `ctx.auth.user`, which the kit middleware sets once prerequisite 0.3 lands (or
  `middleware.auth()` sets). No user → `FORBIDDEN`.
- Normalises the scope key (5.1); malformed → `FORBIDDEN` (do not reveal existence).
- Loads the membership without locking. Missing or `suspended` → `FORBIDDEN`.
- Sets `ctx.membership: Membership` (module augmentation on `HttpContext` declares
  `membership?: Membership | null`).
- No caching across requests.
- Docs note: under Masquerade the effective guard is the business guard, so `ctx.auth.user`, the
  membership and the Bouncer subject are the same customer. **[repo]**
  `oss-adonisjs-masquerade/README.md:36-44`.

---

## 8. Bouncer integration (`src/abilities.ts`)

```ts
ac.abilities(resolve: () => Membership | null | undefined): Record<PermissionKey, BouncerAbility<{ id: UserKey }>>
// Any app user model with an `id` narrows correctly under Bouncer's NarrowAbilitiesForAUser.
```

- One ability per permission key, named exactly by the key (`project:write`).
- Each ability, when executed with Bouncer's subject `user`:
  1. `m = resolve()`; if `!m` → false.
  2. `m.status !== 'active'` → false.
  3. `String(m.userId) !== String(user.id)` → false.
  4. return `can(m.role, key)`.
- Guests: Bouncer's default (`allowGuest: false`) denies without calling the ability.
- The resolver is read on every execution (lazy), never captured at construction.

App wiring (documented; `configure` prints it, does not edit the file):

```ts
// app/middleware/initialize_bouncer_middleware.ts
import accessControl from '@kevinjohn/adonisjs-access-control/services/main'

ctx.bouncer = new Bouncer(
  () => ctx.auth.user || null,
  { ...abilities, ...accessControl.abilities(() => ctx.membership) },
  policies
).setContainerResolver(ctx.containerResolver)

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    bouncer: Bouncer<
      Exclude<HttpContext['auth']['user'], undefined>,
      typeof abilities & ReturnType<typeof accessControl.abilities>,
      typeof policies
    >
  }
}
```

Usage: `await bouncer.authorize('project:write')`, `await bouncer.allows('members:manage')`, Edge
`@can('project:write')`.

---

## 9. Account Kit callbacks (`./account-kit`)

```ts
export function accessControlKitCallbacks(options?: {
  /** Existing app callback to run after the package's, in the same transaction. */
  onInvitationAccepted?: AccountKitConfig['onInvitationAccepted']
  /** Set false to skip admission checks even when the admission provider is registered. */
  admission?: boolean
}): {
  authorize: Required<
    Pick<AuthorizationCallbacks, 'invite' | 'manageInvitation' | 'listInvitations'>
  >
  onInvitationAccepted: NonNullable<AccountKitConfig['onInvitationAccepted']>
  onAccountDeletingTransaction: NonNullable<AccountKitConfig['onAccountDeletingTransaction']>
  exportAccountData: NonNullable<AccountKitConfig['exportAccountData']>
}
```

Behaviour:

| Callback                                                 | Behaviour                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authorize.invite(actor, role, context)`                 | Never locks: reads through `context.trx` without `forUpdate`. False if `context.scope` is null or malformed, `role` unknown or `O`, actor not admitted (when admission is enabled), actor lacks an active membership with `invitations:manage` in that scope, or `rank(role) > rank(actorRole)`. Uses `context.trx` when present (the kit's in-transaction recheck), otherwise a plain read. |
| `authorize.manageInvitation(actor, invitation, context)` | same checks against `invitation.scope` and `invitation.role`                                                                                                                                                                                                                                                                                                                                 |
| `authorize.listInvitations(actor, context)`              | false if `context.scope` is null; else actor admitted and has an active membership with `invitations:manage` in that scope                                                                                                                                                                                                                                                                   |
| `onInvitationAccepted(user, invitation, trx)`            | null `invitation.scope` → do nothing (not a team invitation); else `acceptInvitation({ scopeId: invitation.scope, userId: user.id, role: invitation.role, invitationId: invitation.id, trx })`; then the app callback if given                                                                                                                                                               |
| `onAccountDeletingTransaction(user, trx)`                | `memberships.prepareAccountDeletion({ userId: user.id, trx })` (5.4)                                                                                                                                                                                                                                                                                                                         |
| `exportAccountData(user, trx)`                           | `memberships.exportFor({ userId: user.id, trx })`                                                                                                                                                                                                                                                                                                                                            |

- All `authorize.*` callbacks only read (through `context.trx` when given, never `forUpdate`); they
  never lock rows inside the kit's transaction.
- The callbacks are created in `config/account_kit.ts`, before providers boot, so they resolve
  `AccessControl` lazily on every call (`app.container.make(AccessControl)`), never at creation.
- Admission is checked with `AccountAdmission.isAdmitted(userId, trx)` (`src/admission/service.ts:99`)
  when `app.container.hasBinding('account_admission')` is true at call time **[repo]**
  `src/admission/provider.ts`, unless `options.admission === false`.
- **Acceptance failures fail the whole acceptance [decided].** `acceptInvitation` errors
  (`SCOPE_NOT_FOUND` for a deleted team, `UNKNOWN_ROLE`/`INVALID_INPUT` for a renamed or owner role,
  `ALREADY_MEMBER`) propagate and roll back the kit's acceptance transaction, matching #768's proposal.
  Silently skipping would hide a data-path error. Apps that prefer to skip wrap the callback.
- With admission evidence enabled, the app composes
  `onInvitationAccepted: withInvitationEvidence(callbacks.onInvitationAccepted)`. **[repo]**
  `src/admission/invitation_evidence.ts`.
- `onInvitationAccepted` also fires from `src/invitation_match.ts` (social registration, activation,
  a reset that confirms a never-confirmed account) **[repo]**; behaviour is identical on every path.
- If the app already has `exportAccountData`, it merges the package's object into its own; documented.
- Invitations are stored grants: acceptance does not re-check the inviter.

Wiring example in `docs/guide/account-kit.md`:

```ts
const kitCallbacks = accessControlKitCallbacks()
export default defineConfig({
  // ...
  authorize: kitCallbacks.authorize,
  onInvitationAccepted: kitCallbacks.onInvitationAccepted,
  onAccountDeletingTransaction: kitCallbacks.onAccountDeletingTransaction,
  exportAccountData: kitCallbacks.exportAccountData,
})
```

---

## 10. Client payload (`src/payload.ts`)

```ts
ac.clientPayload(membership: Membership | null): ClientPayload | null

export interface ClientPayload<Role extends string = string, Key extends string = string> {
  scopeId: string
  role: Role
  permissions: Key[]
  assignableRoles: Role[]
}
```

- `null` in → `null` out. Suspended membership → `null`.
- `scopeId` is always a string in the payload.
- `./types` re-exports `ClientPayload`, plus `RoleOf<typeof config>` and `PermissionKeyOf<...>` helpers,
  type-only.

---

## 11. `configure` command

`node ace configure @kevinjohn/adonisjs-access-control --scope-table=teams [--scope-id-type=integer]
[--users-table=users] [--user-id-type=integer] [--memberships-table=memberships]`. Flags only, no prompts, same value sets as Account
Kit's own configure flags (`configure.ts:211-227`). **[repo]**

1. Fail with a clear message if `config/account_kit.ts` is missing, or `--scope-table` is missing, or a
   table name or id type is invalid.
2. Write `config/access_control.ts` from `stubs/config.stub` (the 2.1 example with the flag values),
   always including `membershipsTable: '<value>'` (default `'memberships'`).
3. Publish `database/migrations/<timestamp>_access_control_create_memberships.ts` with placeholders filled.
4. Register `@kevinjohn/adonisjs-access-control/access_control_provider` in `adonisrc.ts`.
5. Register named middleware `scope` → `@kevinjohn/adonisjs-access-control/middleware` in
   `start/kernel.ts` (`codemods.registerMiddleware('named', ...)`).
6. Print the Bouncer initializer change (section 8) and the Account Kit config change (section 9).
7. Idempotent: existing files are skipped with a message; never overwritten.

## 12. Milestones

Each milestone is one pull request, passes the gate, and lists its tests by name.

| #   | Scope                                                                                                                                                                                         | Done when                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Scaffold the repository from the template (section 1): every file in 1.3-1.10, empty exports, this spec moved to `docs/maintainers/design/spec-access-control.md`, requirement ledger started | `pnpm check --full` green; CI green on SQLite, PostgreSQL and MySQL; `test:built-exports` covers every subpath in 1.7; docs build |
| M1  | `defineAccessControl`, validation (2.3), types, `src/rules.ts` (section 3)                                                                                                                    | unit tests below for 2.3 and every row of 3.1, 3.2, 3.4                                                                           |
| M2  | Migration stub, lock process (4.2), service (section 5), errors (section 6)                                                                                                                   | requires prerequisite 0.2; DB tests below pass on SQLite, PG, MySQL                                                               |
| M3  | Scope middleware (7), abilities (8), services/main, client payload (10)                                                                                                                       | requires prerequisite 0.3; integration tests below                                                                                |
| M4  | Account Kit callbacks (9)                                                                                                                                                                     | requires #768 and the transaction export; tests below                                                                             |
| M5  | `configure` (11), `access-control:doctor` (17.2), docs (14, 17)                                                                                                                               | configure and doctor tests on a fresh app; docs reviewed                                                                          |

### Tests (minimum, by milestone)

- **M1:** each validation failure in 2.3 throws; `can` per key per role; `assignableRoles` with and
  without `O`; every row of tables 3.1 and 3.2 including first-match order; identity predicate: empty
  target false, self with non-empty true, self with empty false, missing actor scope false, suspended
  target scope counts, admin-on-owner denied.
- **M2:** unique `(scope_id, user_id)`; `add` happy path and each error; `changeRole`/`setStatus`/
  `remove`/`leave` happy paths and errors; unchanged role/status writes nothing and emits nothing;
  `transferOwnership` demotes to highest non-owner atomically (failure mid-way rolls back both);
  `onMembershipChanged` throwing rolls back the write; **concurrent `createFirstMember` on an empty
  scope: exactly one succeeds**; concurrent `remove` of two admins by each other: at most one succeeds;
  concurrent `transferOwnership` twice, and transfer versus remove: exactly one active owner remains;
  each `transferOwnership` error code; `add` for a missing user → `USER_NOT_FOUND`; non-manager gets 403,
  not 404, for a missing target; `identityRoles` maps (actor active only, target includes suspended);
  `assertCanAdministerIdentity` allowed and `FORBIDDEN`; a stored role outside the tuple → `can` false,
  `canManage` `UNKNOWN_ROLE`; `SCOPE_NOT_FOUND`; cursor paging across equal `created_at`;
  caller-supplied `trx` path and package-owned path both covered; deleting a scope or user row with
  memberships still present fails on the `RESTRICT` key; `removeAllForScope` emits one
  `scope_deleted` event per membership and the scope row then deletes; custom `membershipsTable`.
- **M3:** Bouncer: editor allows `project:write`, denies `project:archive`; membership set after
  Bouncer construction is seen; no membership denies; suspended denies; abilities reused with another
  subject deny; guest denies; concurrent requests in different scopes isolated; app abilities still
  work; `authorize` throws 403; Edge `can`/`cannot` with colon keys. Middleware: non-member 403,
  suspended 403, malformed scope 403, member sets `ctx.membership`; route without middleware has no
  membership; **kit middleware only (no `middleware.auth()`)**: member request sets `ctx.membership` and
  `bouncer.allows` works; named `middleware.scope()` and `.use(scopeMiddleware())` behave the same; a
  stored role outside the tuple → 403. Payload: null, suspended, editor shapes.
- **M4:** invite allowed/denied per rule and per admission state; manage and list per scope; one
  address invited to two scopes accepted once → two memberships (scope locks and events in ascending
  `String(scope)` order); acceptance via `invitation_match`
  path; null-scope invitation ignored; acceptance with a deleted scope, a renamed role and an existing
  membership each fail the whole acceptance (no user created); deletion refused for an active owner,
  allowed otherwise with one `account_deleted` event per membership and the user row deleted; export shape; composition with `withInvitationEvidence`; callbacks
  created before the provider boots still work; admission skipped when the provider is absent.
- **M5:** configure on a fresh AdonisJS app with Account Kit writes every file, re-run is a no-op; the
  generated migration runs on SQLite, PostgreSQL and MySQL against `increments()` parents, and for
  `uuid` and `string` key types.

---

## 13. Bouncer spike result (2026-11-05)

Throwaway code in `/tmp/ac-spike/` (`spike.ts`, `types_check.ts`) against `@adonisjs/bouncer` 4.0.1
as installed in CapacityLens. **[repo]**

- 11/11 runtime checks pass: the cases listed for M3 above.
- Mutation 1 (remove the subject id check): the "reused with another subject" check fails.
- Mutation 2 (resolve the membership eagerly at construction): lazy, isolation, editor and Edge checks
  fail.
- Type check: generated `resource:action` keys merge with app abilities in `new Bouncer<User, typeof
all>`; an unknown key (`project:delete`) fails to compile (`@ts-expect-error` removed → `tsc` exit 2).
- Edge's `bouncer.can('project.write')` throws `Invalid bouncer policy "'project'"` because it splits on
  `.`; this is why keys use `:`.
- Bouncer memoises the resolved user per instance but calls ability functions on every check, so a
  per-request resolver closure is enough; no async local storage, no WeakMap, no rebuild of
  `ctx.bouncer`.

## 14. Documentation (M5)

Layout per 1.9. `README.md` (what, install, 10-line quick start, Tested against table), `README-AGENTS.md`,
`docs/reference/errors.md`, `docs/guide/`:
`setup.md`, `roles.md` (config, keys, deployment contract), `rules.md` (truth tables in prose,
no last-manager guarantee), `memberships.md` (service API, trusted operations warning, events),
`bouncer.md` (wiring, Edge), `account-kit.md` (callbacks, admission, evidence composition),
`client.md` (payload, type-only imports). Original wording and examples only; nothing copied from
AdonisJS Plus docs.

## 15. Out of scope for v1

Custom or runtime roles; roles table; several roles per member; record-level rules; attribute-based
rules; admin UI; per-scope rate limits; scope CRUD; shipped translations; permission key aliases or
inactive keys; access-token narrowing; inviting existing accounts into another scope; join-scope
flow; configurable membership column names.

## 16. Review record

An independent high-effort review of this spec on 2026-11-05 found 24 findings (3 P1, 13 P2, 8 P3), all applied.
P1s: Account Kit middleware does not set `ctx.auth.user` (now prerequisite 0.3); `bigInteger` keys
break MySQL foreign keys (now the kit's `integer | string | uuid` mapping); acceptance failure policy
was unstated (now whole-acceptance failure). Notable P2s: user-row locks freeze membership sets for
identity and deletion checks (4.2); identity checks run before, not around, kit operations (5.3);
named middleware needs a class default export (7); callbacks resolve services lazily (9); configure
uses flags (11); prefixed error codes (6).

A second independent review on 2026-11-05 (section 1, the post-review changes and the Account Kit
prerequisites): 16 findings (3 P1, 9 P2, 4 P3), all applied. P1s: the root export lacked `configure`
and `stubsRoot`; copied `bin/test_consumer.ts` needed excluded helpers; docs build inputs were missing
from the manifest. Notable P2s: a deadlock in scope deletion's retry; multi-scope acceptance lock order
(now pinned on #768); the kit's real lock order; error response shape; missing `luxon`; test schema
fixtures. Section 17 (change over time) was added after this review and has not been reviewed.

## 17. Change over time [decided]

### 17.1 The package's own schema

- **Released migration stubs are immutable.** Once a version ships, its stubs never change. Schema
  changes ship as **new, additive** stubs.
- Every stub has a stable name: `access_control_create_memberships` for v0.1 (the package prefix
  keeps the published file name clear of an app's own `create_memberships` migration); later ones
  `access_control_<YYYYMMDD>_<change>` (e.g. `access_control_20270115_add_membership_note`).
- `stubs/migrations/released.json` records `{ name, sha256 }` for every released stub.
  `tests/migration_stubs.spec.ts` fails if a listed stub's hash changes or a listed stub is deleted.
  Adding a stub to a release adds its entry in the release PR.
- `configure` publishes every stub whose stable name is not already present (matched by file-name
  suffix in `database/migrations/`) and never rewrites an existing file. Re-running `configure` after
  an upgrade is how an app receives new migrations.
- The changelog gets a `### Migrations` subsection for any release that adds a stub, naming the stub
  and what it does.
- A change that cannot be additive (dropping or renaming a column) is a breaking release (17.4) with
  explicit data-migration steps in the changelog.

### 17.2 `node ace access-control:doctor`

Read-only consistency check for the database against the config. Run it before and after any role,
owner or package upgrade.

```
node ace access-control:doctor [--scope=<id>] [--json]
```

Checks, each reported with a count and up to 20 sample ids (ids only, never names or emails):

1. The memberships table exists with the expected columns.
2. Memberships whose `role` is not in `roles` (renamed or removed roles).
3. Memberships whose `status` is not `active` or `suspended`.
4. When `ownerRole` is set: scopes with members but no active owner; scopes with more than one active
   owner.
5. Memberships whose `scope_id` or `user_id` has no matching row (possible only if the app's foreign
   keys are missing).
6. The installed Account Kit version matches the package's exact peer.

Exit code `0` when clean, `1` when any check finds rows, `2` when the check could not run. `--json`
prints `{ checks: [{ name, ok, count, sampleIds }] }`. No writes, no locks.

### 17.3 Role and owner changes (guide: `docs/guide/changing-roles.md`)

- **Rename a role:** change the config and, in one app migration, `UPDATE <membershipsTable> SET role
= '<new>' WHERE role = '<old>'` and the same for pending `account_invitations.role`; deploy both
  together; run the doctor.
- **Remove a role:** move its members to another role first (same migration shape), then remove it
  from the config.
- **Turn the owner role on later:** run the doctor (check 4 lists every scope without an owner); assign
  one owner per scope with an app migration, choosing by the app's own rule (for example the earliest
  active member with the highest role); set `ownerRole`; run the doctor again before relying on owner
  rules.
- **Turn the owner role off:** remove `ownerRole`; owner rows keep the role name, which must stay in
  `roles` (or be renamed as above).
- **Rename a permission key:** code-only (keys are not stored), but frontends reading
  `payload.permissions` must change in the same deploy. Aliases are a later candidate (section 15).

### 17.4 Versioning and upgrades

- Semver. While on `0.x`: a **patch** never breaks; a **minor** may break only with a `### Changed`
  entry marked **Breaking** and an `### Upgrading` section in the changelog giving exact steps.
- Public API for this purpose: exports and their signatures, config keys, permission-key format,
  error codes, `MembershipEvent` types, client payload shape, migration stub names and columns,
  `configure` flags, doctor exit codes and JSON shape.
- Account Kit upgrades: the peer is an exact version, so a kit release that this package adopts is a
  package release; update the dev-dependency tarball URL, version and checksum together (1.11).

### 17.5 Unsupported after install

Changing `membershipsTable`, `users.table`, `scope.table` or any `keyType` after the first migration
has run is not supported; it needs a new install and an app-written data copy. Documented in
`docs/guide/setup.md`.

### 17.6 Release verification

After each release is published, install the advertised README tarball in a fresh AdonisJS 7 app with
Account Kit, run `configure`, migrate, run the doctor (expect exit 0) and one scoped request with a
Bouncer check. Record the result in `docs/maintainers/verification.md`, as Account Kit does
(`docs/maintainers/release-gate.md`). **[repo]**

### 17.7 Tests (added to milestones)

- **M2:** `tests/migration_stubs.spec.ts` (hash manifest; mutation: edit a stub, the test fails).
- **M5:** doctor: each check on seeded bad data, clean data exits 0, `--json` shape, `--scope`
  filter, no writes (row counts unchanged); configure re-run after adding a second stub publishes only
  the new one.
