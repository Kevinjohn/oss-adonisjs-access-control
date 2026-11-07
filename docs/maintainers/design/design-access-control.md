# oss-adonisjs-access-control: thoughts and decisions

Date: 2026-11-05. Status: design agreed and adversarially reviewed (section 12), nothing built. The
build contract is [`spec-access-control.md`](spec-access-control.md); where they differ, the spec wins. No repository, issue or package exists yet.

Evidence labels used below:

- **[repo]** a fact read from a repository at the stated path (revision noted where relevant).
- **[owner]** context or a decision given by the owner in conversation.
- **[external]** read from a third-party site or package on 2026-11-05.
- **[inference]** reasoning or a recommendation, not yet verified by building it.

---

## 1. Purpose

A small, free, MIT-licensed AdonisJS 7 package that fills the gap between identity (Account Kit) and
record-level authorization (Bouncer policies):

- **Team membership**: which team (scope) a user belongs to, and with which role.
- **Permission matrix**: what each role may do, declared in code.

It sits on top of Account Kit and alongside Bouncer. It does not replace or compete with Bouncer.
**[owner]**

Motivation:

- Bouncer covers "can this user do this to this record" but has no roles or memberships. **[external]**
- The only ready-made role/permission layer with good documentation is AdonisJS Plus
  `@adonisplus/permissions`, which is paid. The owner considers this basic functionality that should
  be freely available. **[owner]**
- The free community option, `@holoyan/adonisjs-permissions`, solves a different problem (section 5.2).
- CapacityLens already implements a good version of both layers in product code (section 4); the
  package generalises it so any Account Kit app can use it. **[owner]**

---

## 2. Vocabulary

Use these terms consistently in the package, docs and issues.

| Term                    | Meaning                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity / user         | One global person row per email address. Owned by Account Kit.                                                                                                   |
| Scope / team            | The thing a user is a member of: a company, workspace, organisation or team. The app owns this table and names it. The package only stores its id as `scope_id`. |
| Membership              | The link `user_id + scope_id + role + status`. Owned by this package.                                                                                            |
| Role                    | A named, ranked level a member holds in one scope, e.g. `viewer < editor < admin < owner`. Declared in code.                                                     |
| Permission key          | A `resource:action` string such as `project:write` (colon, so Edge `@can` works). Declared in code with the lowest role allowed.                                 |
| Owner role              | Optional. A role the config marks as the owner role, which turns on the one-owner rules.                                                                         |
| Current scope           | The scope the current request is acting in, resolved by middleware.                                                                                              |
| Invitation role / scope | Account Kit fields on an invitation. The kit stores them without interpreting them; this package interprets them. `scope` is proposed in Account Kit #768.       |

The four authorization layers:

1. **Identity**: who you are. Account Kit.
2. **Membership / scope**: which team you are in, with which role. **This package.**
3. **Permission matrix**: what that role may do. **This package.**
4. **Record-level policy**: rules about a specific record (ownership, state, relationships). The app's
   Bouncer policies.

---

## 3. Account Kit today (why the package is needed)

### 3.1 Account Kit has no team concept

- Account Kit has global accounts: one user row per email address, no tenant concept. Workspace
  membership and invitation policy are left to the application. **[repo]**
  `oss-adonisjs-account-kit/docs/recipes/multi-tenant.md` at `8a60eee`.
- `Invitation.role` is an opaque string. The kit stores it; the app's `onInvitationAccepted` applies
  it. **[repo]** `src/types_foundation.ts:112`.
- The package does not create tenant or team membership records unless the application callback does
  so. **[repo]** `docs/guide/usage.md:142-146`.
- The package does not alter team memberships on session or account changes; tenant membership
  cleanup is the application's job. **[repo]** `docs/guide/production-boundaries.md:71-72`.

### 3.2 Invitation limits that make the kit effectively single-team

- `account_invitations.email` is unique: one pending invitation per address across the whole
  installation. **[repo]** `stubs/migrations/create_account_invitations.stub:11`.
- Inviting an existing account throws `EmailAlreadyRegisteredError`, both on send and on accept.
  **[repo]** `src/invitations.ts:66-67, 89, 130`.
- The role column is `string(64)` on invitations and `invited_role string(64)` on admissions.
  **[repo]** `stubs/migrations/create_account_admissions.stub:18`.
- The multi-tenant recipe works around these by encoding the team into the role string
  (`<workspace id>:member`) and replacing the managed invitation list route with an app controller,
  because the package list cannot filter by team. **[repo]** `docs/recipes/multi-tenant.md`.

### 3.3 Account Kit issue #768

Created 2026-11-05: "Scope invitations so one address can be invited to several teams".
https://github.com/Kevinjohn/oss-adonisjs-account-kit/issues/768 **[repo]**

Smallest change proposed:

1. Add an opaque nullable `scope` field to invitations, returned on `Invitation` and passed to
   `authorize.invite`, `authorize.manageInvitation` and `onInvitationAccepted`.
2. Unique on (`email`, `scope`) instead of `email`.
3. On acceptance, consume every pending unexpired invitation for the address in the same transaction
   and call `onInvitationAccepted` once per invitation, so one new account can join several teams.
4. Filter `invitations.list` and the managed list route by scope.

Out of scope there: inviting an existing account into another scope (natural follow-up, needs a
separate signed-in accept flow), any team model, per-scope rate limits.

Open questions there: whole-acceptance failure if one extra callback throws (proposed: fail as a
whole); null-scope uniqueness, since SQLite, PostgreSQL and MySQL treat nulls as distinct in unique
indexes.

The owner agreed invitations are scoped too tightly, but #768 is not needed for the alpha. **[owner]**

**Update:** the owner expects #768 to land on 2026-11-05; this design presumes it is done. **[owner]**
At the time of writing `origin/main` was at `01c5138` (#767), so #768 was not yet merged. **[repo]**

---

## 4. CapacityLens: the reference implementation

CapacityLens is the first intended consumer and the source of the rules being generalised. Paths are
in `capacitylens` at `29f92132`. **[repo]**

### 4.1 Roles and ranking

`packages/shared/src/account/policy.ts`:

- Four roles, ranked: `viewer: 0, editor: 1, admin: 2, owner: 3` (`ROLE_RANK`).
- `isAtLeast(role, minimum)` compares ranks.
- Administration actions, each with a minimum tier (`MIN_ADMIN_TIER`):
  - admin: `list-members`, `manage-members`, `manage-invitations`, `masquerade-member`,
    `act-on-ownership-transfer`
  - owner: `manage-member-sign-in-tracking`, `transfer-ownership`, `erase-workspace`

### 4.2 Product permissions

`packages/shared/src/domain/access.ts`:

- A closed union of actions: `read`, `write`, `manageInternalClient`, `manageMembers`, `manageInvites`,
  `masquerade`, `manageMemberSignInTracking`, `anonymise`, `transferOwnership`,
  `actOnOwnershipTransfer`.
- Product-data thresholds: `read: viewer`, `write: editor`, `manageInternalClient: admin`,
  `anonymise: admin`. Administration actions map onto `policy.ts`.
- `satisfies Record<Action, …>` makes a missing rule a compile error.
- `can(role, action)` is pure and imported by both browser and server.

### 4.3 Member-management rules (the part Plus does not document)

`packages/shared/src/account/policy.ts`:

- `canEditAnyMemberRole(actor, target)`: actor needs `manage-members` (admin tier); target must not be
  the owner. An owner's role only moves through ownership transfer.
- `canManageMemberRole(actor, target, next)`: the above, and `next` must not be `owner`. Promotion to
  owner is reserved to transfer.
- `canRemoveMember(actor, target)`: admin tier, target not owner.
- `canChangeMemberStatus(actor, target, isSelf)`: same as removal, and never on yourself. A sole admin
  who disabled themselves would lock themselves out unrecoverably.
- `canAdministerIdentity(actor, target)`: identity security operations (password reset, session
  revocation) need admin tier; only an owner may act on an owner.
- `canAdministerIdentityAcrossWorkspaces(...)`: identity operations affect every workspace the target
  belongs to, so the actor needs sufficient standing **in every one of the target's workspaces**.
  This is the key multi-team rule.
- A code comment on `canChangeMemberStatus` says a single-active-owner index and a boot assertion key
  on `role = 'owner' AND status = 'active'`. The baseline migration (`memberships` has only
  `unique(account_id, user_id)`) and boot code do not establish either, so treat this as an
  unverified comment, not prior art. **[review]**

### 4.4 Memberships table

`apps/backend/database/migrations/202610120001_create_capacitylens_baseline.ts:255-267`:
`account_id` (FK to `accounts`, cascade), `user_id` (FK to `users`, cascade), `role`, `status`,
unique (`account_id`, `user_id`). In CapacityLens the `accounts` table is the company; Account Kit's
"account" means the user. **[repo]**

### 4.5 The single-company hardcode

- `installationCompanyId()` returns the one company and throws `MULTIPLE_COMPANIES` if there are two.
  **[repo]** `apps/backend/app/services/account_kit/policy.ts:29`.
- Used in `policy.ts`, `invitations_controller.ts`, `services/membership/admission_membership.ts`.
- `DECISIONS.md:84`: "One production installation holds one company; the demo may hold several."
- Invitation roles are plain (`viewer`, `editor`, `admin`); the company is implied.
- The data model is already per-company: every scoped row carries a company id and authorization is
  per membership (`DECISIONS.md:81`). Multi-company later is mostly product work: remove the
  hardcode, add company selection, use #768 for invitations. **[inference]**

CapacityLens does not need the package for the alpha. **[owner]**

---

## 5. Prior art

### 5.1 Bouncer (official)

Abilities and policies, wired per request through `initialize_bouncer_middleware`. No roles, no
memberships. The package adds generated abilities to Bouncer; app policies stay as they are.
**[external]**

### 5.2 `@holoyan/adonisjs-permissions`: evaluated, rejected

Facts **[external]**, source read at commit `565e2c4` (2026-05-12):

- npm `2.0.2` on 2026-05-12, targets `@adonisjs/core ^7.0.1`, `@adonisjs/lucid ^22.1.1`. `v1-latest`
  `1.3.4` for AdonisJS 6. GitHub Releases page stops at `v1.2.0` (2025-07-06), which makes it look
  older than it is.
- Single maintainer, occasional outside PRs (AdonisJS 7 port was #32). All 24 issues closed, mostly
  answered. About 2,838 downloads in the month to 2026-11-03. About 95 tests, SQLite by default.
- Port of the Laravel database-driven model: roles and permissions are rows created at runtime,
  assigned polymorphically to any model through a `@MorphMap` decorator.
- Scope (tenant) is a `string` column on **role and permission rows**, not on the assignment. A
  shared "admin" role needs one row per tenant. Issue #31 hit this.
- No unique constraint on role slug per scope; no unique constraint on assignment tables.
- Supports deny rows (`allowed = false`), class/model-level permissions, events, transactions.
- Bouncer integration is an unchecked roadmap item (README line 1365).
- No membership concept, status, role ranking, owner rules or invitation link.

Why rejected **[inference]**: different model (runtime DB rows versus code-declared), no
compile-time exhaustiveness, scope stored in the wrong place for shared roles, no membership layer,
no Bouncer integration, single-maintainer risk.

### 5.3 AdonisJS Plus `@adonisplus/permissions`: design ideas only

Read from the public docs pages (introduction, quick start, defining permissions, access control,
team permissions, Bouncer integration) through a fetch tool's summaries, not raw text. **[external]**

Licence finding **[external]**, https://plus.adonisjs.com/terms:

- No MIT or open-source licence for Plus material. Paid Feature Packs carry a perpetual,
  non-exclusive, non-transferable licence to use; "Redistribute Feature Packs, handbooks, or AI rules
  in any form" is prohibited; ownership stays with AdonisJS.
- The public docs and their code examples are not covered either way.
- **Decision:** use the docs for design ideas only. Write original code, examples and documentation.
  Never copy their examples or wording. (Not legal advice.) **[owner]** agreed to building our own.

Their design:

- Peer deps: `@adonisjs/core ^7`, `@adonisjs/bouncer ^4`, `@adonisjs/lucid ^22`.
- `definePermissions(...definitions)` merges nested `resource: { action: value }` objects into one
  typed `Permissions` instance. Value is `true` (generated description), a description string, or
  `{ description, inactive, aliases }`.
- Keys are `resource.action`; `prefix(namespace, def)` gives `namespace:resource.action`.
- `aliases` rename a key without breaking stored assignments. `inactive: true` retires a key: still
  listed by `keys()`/`all()`, excluded from `active()`, checks and `filterKeys()`.
- Instance: `all()`, `keys()`, `active()`, `getKey(key)` (typed, throws if unknown),
  `filterKeys(raw)` (drops unknown/inactive, canonicalises), `createAccess()`,
  `createAccessFor(entity)` (entity implements `getPermissions()`), `abilities()`.
- `Access`: `use(keys)`, `allows(key)`, `denies(key)`, `permissions()`, `scopeTo(tokenAbilities)`
  (intersection with an access token's abilities).
- Roles are DB rows (`roles`: `id`, unique `name`, `permissions` JSON text). Users get roles through
  `user_roles` (unique user + role). `withPermissions()` and `withRoles()` Lucid mixins.
- Configure command creates `start/permissions.ts`, an `authorize_middleware`, kernel and provider
  registration, and an Inertia `utils/permissions.tsx`.
- Bouncer: `abilities()` produces one ability per active key, computed once at import, spread into
  the Bouncer constructor. Optional second argument narrows to token abilities. Record-specific rules
  stay in hand-written abilities/policies.
- Teams: `team_members` (unique team + user) and `team_member_roles` pivot (unique member + role).
  Roles are shared across teams. Current team comes from `params.teamId` in examples. Checks build a
  **second Bouncer with the member as the subject**: `new Bouncer(member, permissionAbilities)`.
- Not documented: removing members, unassigning roles, listing a user's teams, who may manage whom,
  owner rules, invitation integration, team resolution beyond route params.

What we take: typed `resource.action` keys, generated Bouncer abilities, the split between
permission checks and record-level policies, and later `aliases`, `inactive` and token narrowing.

What we do differently: roles declared in code (no roles table), one ranked role per membership,
member-management rules, owner rules, Account Kit integration, one Bouncer per request.

---

## 6. Decisions

Each decision: what, why, rejected alternative.

### D1. Separate package on top of Account Kit

- **What:** `oss-adonisjs-access-control`, a new repository (name chosen by the owner). Not part of
  Account Kit core. **[owner]**
- **Why:** Account Kit stays identity-only. Teams in the core would force one membership model on every
  kit user. Same pattern as Masquerade, which ships an `account_kit/` integration. **[repo]**
  `oss-adonisjs-masquerade/account_kit/`.
- **Rejected:** teams inside Account Kit; building on holoyan; buying Plus.

### D2. Roles and permissions in code, not the database

- **What:** roles and the permission matrix are declared in TypeScript config. No roles table, no
  runtime role editing. **[owner]** ("Things in code not DB in particular.")
- **Why:** compile-time exhaustiveness, reviewable in pull requests, no seeding, matches CapacityLens.
  Stored rows still name roles, so role renames and owner-role changes are migrations (7.1 deployment
  contract). **[review]**
- **Rejected:** DB-driven roles (holoyan, Plus).

### D3. Ranked roles, one role per membership

- **What:** roles are an ordered list, lowest first. Each permission key names the lowest role allowed.
  A membership holds exactly one role.
- **Why:** covers small products; makes "who may manage whom" a rank comparison.
- **Rejected:** many-to-many roles; free permission sets per role; custom roles per team.

### D4. Server first

- **What:** the server owns the matrix, memberships, scope resolution, Bouncer abilities, Account Kit
  hooks and every check. The client receives only:
  - type-only imports of the permission-key and role unions (erased at build);
  - a fixed payload: the current member's resolved permission keys and the roles they may assign;
  - optionally a tiny helper that reads that payload, containing no rules.

  The role table, rank logic and any check the server relies on never ship to the browser.
  **[owner]** ("Server first (not quite server only).")

- **Why:** one source of truth; nobody mistakes a client check for authorization; no browser bundle
  constraint on the package; the role table isn't shipped to visitors.
- **Accepted trade-offs:** the browser cannot predict what another role could do without asking; a role
  change is seen on the next fetch. **[owner]** ("100% happy with those trade offs.")
- **Rejected:** shared pure module imported by browser and server (what CapacityLens does today; that
  remains a product choice).

### D5. Account Kit is a required server-side peer dependency

- **What:** the package depends on Account Kit. **[owner]** Confirmed after review, overriding both
  reviewers' recommendation to make it optional behind an `/account-kit` subpath like Masquerade.
- **Why:** removes generic plumbing. The package uses the kit's user types, users-table metadata,
  hooks and middleware (section 7.8). Fewer moving parts to document.
- **Cost:** apps without Account Kit cannot use the package. The Masquerade precedent in D1 is about
  keeping the kit identity-only, not about optional coupling.
- **Rejected:** optional Account Kit behind a subpath (review proposal); a generic user-model adapter.

### D6. The app owns the teams table

- **What:** the package stores memberships with a `scope_id` pointing at the app's own table
  (companies, workspaces, teams). It never creates, names or deletes teams. **[owner]**
- **Rejected:** a package-owned minimal teams table (clashes with apps that already have one).

### D7. Owner rules are opt-in

- **What:** if config names an owner role, the package enforces one active owner per scope, blocks
  removing, suspending or deleting the last owner, reserves promotion to and demotion from owner for
  an atomic transfer. Otherwise there is no owner concept. **[owner]**
- **Rejected:** always on; left entirely to the app.

### D8. Bouncer integration through the request's membership

- **What:** generated abilities, one per permission key, check the membership resolved for the current
  request. `ctx.bouncer` stays user-based and is built once in the app's existing initializer, which
  merges in the package's abilities from a request-aware factory (7.7). **[review]** This is one line
  added to the app's Bouncer initializer, not zero changes. Owner liked the original direction.
  **[owner]**
- **Rejected:** Plus's pattern of a second Bouncer instance with the member as subject.

### D9. Package first, invitation link after #768

- **What:** build roles, memberships, scope middleware and Bouncer abilities first. Add the Account Kit
  invitation integration once #768 lands. **[owner]** #768 is now presumed done, so the invitation
  integration uses the invitation `scope` field from the start.

### D10. Defaults taken (owner may override)

- `scope_id` and `user_id` types follow the app's (number or string), configured once, along with
  the physical users and scope tables (7.10).
- Membership `status`: `active` or `suspended`.
- Current scope from a route parameter by default (`:scopeId`, name configurable).
- MIT licence; released through GitHub releases like the sibling packages.
- Supports the same databases as Account Kit.

### D11. Not created yet

The owner chose "nothing yet" for creating the repository. No repo, no design issue. **[owner]**

### D12. Answers to the open questions (2026-11-05)

- **Demotion on transfer:** the old owner drops to the highest non-owner role (e.g. `admin`). No config.
  **[owner]**
- **Leaving a team:** any non-owner may always remove their own membership. Owners must transfer
  first. No config. **[owner]**
- **Package name:** `@kevinjohn/adonisjs-access-control`, matching Account Kit's scoped naming. Repo
  `oss-adonisjs-access-control`. **[owner]**
- **Before #768:** ~~invitation helpers use the `<scopeId>:<role>` encoding~~. Superseded: #768 is
  presumed done, so there is no encoded form, codec or legacy decoder. **[owner]**
- **Single-owner enforcement:** ~~MySQL lock-only on the scope's membership rows~~. "MySQL is a choice
  the owner makes. We code for process, not DB choice." **[owner]** One process on every database: lock
  the app's scope row, then re-read and check (7.6). No database-specific owner indexes.

---

## 7. Proposed design

Sketches are illustrative and original; names may change during implementation. **[inference]**
Revised after the adversarial review (section 12); changes agreed by both reviewers are marked **[review]**.

### 7.1 Defining roles and permissions

```ts
// config/access_control.ts
import { defineAccessControl } from '@kevinjohn/adonisjs-access-control'

export default defineAccessControl({
  roles: ['viewer', 'editor', 'admin', 'owner'],
  ownerRole: 'owner', // optional; enables D7
  permissions: {
    project: { read: 'viewer', write: 'editor', archive: 'admin' },
    members: { list: 'admin', manage: 'admin' }, // both required
    invitations: { manage: 'admin' }, // required
    workspace: { erase: 'owner' },
  },
})
```

- `roles` is a readonly tuple; rank is the index.
- Each action value is a role from `roles`. A role not in the tuple fails to compile.
- **One authority source [review]:** there is no `managerRole`. `members:list`, `members:manage` and
  `invitations:manage` are reserved keys the config must define. **[owner]** (`members:list` required.) The membership service and the
  generated Bouncer abilities consult the same key for the same action, then apply target-rank,
  assignment and owner restrictions.
- **Config validation at boot [review]:** reject an empty or duplicate role tuple, role references not
  in the tuple, role names longer than the kit's 64-character invitation role limit, and, when
  `ownerRole` is set, an owner that is not the highest rank or a tuple with no non-owner role.
- Exported types: `Role`, `PermissionKey` (`'project:read' | 'project:write' | …`).
- Optional later: action value may become `{ role, description, inactive, aliases }`.
- **Deployment contract [review]:** roles are code, but stored rows name them. Renaming or removing a
  role, or changing `ownerRole`, is a migration over memberships and pending invitations. This replaces
  the earlier "no drift" claim in D2.

### 7.2 Pure core (server-side)

- `ac.rank(role)`, `ac.isAtLeast(role, minimum)`.
- `ac.can(role, key)`: true when the role ranks at or above the key's minimum. Unknown role or key
  returns false.
- `ac.permissionsFor(role)`: every key the role grants.
- `ac.assignableRoles(actorRole)`: roles the actor may give (section 7.5), derived from the same rules
  the service enforces.
- `ac.canAdministerIdentity(actorRoles, targetRoles, isSelf)` (section 7.5).
- No AdonisJS imports in this module, so it is easy to unit test; it is still server-only (D4).

### 7.3 Memberships table

Published as a migration stub:

| Column                     | Type                 | Notes                                                                                                |
| -------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                       | increments           | fixed; nothing references a membership by id **[review]**                                            |
| `scope_id`                 | app's scope key type | FK to the app's scope table; cascade on delete                                                       |
| `user_id`                  | app's user key type  | FK to the app's **physical** users table (not assumed to be `users`) **[review]**; cascade on delete |
| `role`                     | string               | must be one of `roles`; validated on every write                                                     |
| `status`                   | string               | `active` or `suspended`                                                                              |
| `created_at`, `updated_at` | timestamp            |                                                                                                      |

Constraints:

- unique (`scope_id`, `user_id`)
- index (`user_id`) for "my scopes"
- when `ownerRole` is set: one active owner per scope is guaranteed by the scope-row lock process
  (7.6), the same on every database. No database-specific owner index. **[owner]**

### 7.4 Membership service

**Transactions [review]:** `trx` is optional on every operation.

- Without `trx`, the service runs inside the package's own `transaction()` runner: on SQLite it takes
  the writer lock as the first statement (before any read) and retries busy errors; MySQL runs at READ
  COMMITTED. Only the transaction owner retries, and only the whole transaction; committed work is
  never replayed.
- With `trx`, the caller must have started it under the same contract (writer lock already held on
  SQLite). A write issued after earlier reads does not satisfy this.
- The earlier claim that "never opening a transaction" is the Account Kit pattern was wrong: kit
  services open their own transactions and pass `trx` to hooks.

**Ordinary operations** (actor-authorized; the actor's **active** membership in the exact scope is
re-read through the write transaction **[review]**):

- `memberships.find(userId, scopeId, trx?)`
- `memberships.listForUser(userId)`: the user's scopes and roles.
- `memberships.listForScope(actor, scopeId, page)`: requires `members:list`.
- `memberships.add({ actor, scopeId, userId, role, trx? })`
- `memberships.changeRole({ actor, scopeId, userId, role, trx? })`
- `memberships.setStatus({ actor, scopeId, userId, status, trx? })`
- `memberships.remove({ actor, scopeId, userId, trx? })`
- `memberships.leave({ scopeId, userId, trx? })`: non-owner self-removal (D12).
- `memberships.transferOwnership({ actor, scopeId, toUserId, trx? })` (only with `ownerRole`)

**Trusted operations [review]** (server-only, no current manager required):

- `memberships.createFirstMember({ scopeId, userId, role, trx? })`: valid only on an empty scope,
  checked under the scope-row lock. Assigns the owner role when `ownerRole` is set; otherwise the role
  must hold `members:manage`.
- `memberships.acceptInvitation({ scopeId, userId, role, trx })`: validates scope and a non-owner role
  and writes through the acceptance transaction. The invitation is a stored grant until it expires or
  is revoked; acceptance does not re-check the inviter. Apps needing acceptance-time reauthorization
  add that policy explicitly.
- `memberships.grant({ scopeId, userId, role, trx })`: a membership the application authorised
  itself (admission, eligibility), inside the application's kit transaction. No actor and no
  invitation; validates scope, user and a non-owner role, refuses an existing membership and emits
  `membership.granted`.

Errors are typed and carry a stable `code` (e.g. `NOT_A_MEMBER`, `ROLE_NOT_ASSIGNABLE`,
`LAST_OWNER`, `SELF_STATUS_CHANGE`, `SELF_ROLE_CHANGE`, `UNKNOWN_ROLE`, `SCOPE_NOT_EMPTY`).

### 7.5 Member-management rules (generalised from section 4.3)

Deny by default. With optional owner role O:

- **Manage a target** (change role, change status, remove): actor holds `members:manage` through an
  active membership in the scope, target rank ≤ actor rank, and target is not O. Equal-rank management
  is allowed deliberately (an admin may manage another admin), matching CapacityLens. **[review]**
- **Assign a role R**: the above, and R rank ≤ actor rank, and R is not O.
- **Change own status**: never.
- **Change own role**: never. A sole manager demoting themselves is the same unrecoverable lockout as
  self-suspension. **[review]**
- **Leave (remove self)**: always allowed for a non-owner. An O must transfer first (D12).
- **No last-manager guarantee without an owner [review]:** when `ownerRole` is unset, the package does
  not stop the last manager leaving or being removed. A scope can end up with nobody able to
  administer it; recovery belongs to the application. With `ownerRole` set, the owner always remains.
- **Owner role**: reached or left only through `transferOwnership`, which the current O runs; one
  transaction demotes the old owner to the highest non-owner role (D12) and promotes the new one, who
  must already be an active member.
- **Identity operations across scopes [review]** (password reset, session revocation by another member):
  - Pure predicate `canAdministerIdentity(actorRoles: Map<scopeId, Role>, targetRoles: Map<scopeId,
Role>, isSelf)`.
  - An empty target map denies. Self succeeds only when the target map is non-empty.
  - Cross-user: the actor needs `members:manage` and sufficient rank in **every** scope in the target
    map; only an O may act on an O in that scope.
  - Actor maps contain active memberships only. Target maps include suspended memberships: a pause is
    not a removal, so that scope still needs the actor's standing. **[owner]** Matches CapacityLens.
  - Enforcement is a separate, transaction-scoped operation that loads both maps through `trx` and holds
    the locks from 7.6 until the identity change is done, so concurrent membership changes cannot slip
    between check and action.

CapacityLens differences to check before adopting: its two-party consent ceremony for transfer stays
product code.

### 7.6 Concurrency [review]

- Membership-row locks cannot protect an empty scope: with no rows there is nothing to lock. Every
  invariant write therefore **locks the app's scope row first**, then re-reads memberships and checks.
  This is one process for every database; per-database locking details stay inside the transaction
  runner (7.4). **[owner]** This covers first-member creation, last-owner,
  single-owner, rank rules against current data, and the account-deletion owner check.
- The scope table and key are configured at setup (7.10).
- The guarantee holds for writers that use the package's operations; direct table writes bypass it.
- Lock ordering must be compatible with Account Kit's existing user and invitation locks. The exact
  order is part of the build.
- Account Kit's `transaction` and `lockRow` helpers are internal and not exported, so the package owns
  its runner (7.4).

### 7.7 Current-scope middleware and Bouncer [review]

**Middleware ordering:** guard authentication → Account Kit middleware → scope middleware. With
admission enabled, use the kit's `admissionMiddleware`: it checks the guard, the credential revision,
the active account and admission (`src/admission/middleware.ts:8-21`). Without admission, use
`managedAccountMiddleware` (`src/http/managed_account_middleware.ts:6-18`). **[repo]** Resolves the
review's disagreement in the second reviewer's favour.

**Scope middleware:**

- Registered on routes that need a selected membership, not globally.
- `resolveScope(ctx)` defaults to `ctx.params.scopeId`. Apps may read a header, subdomain or session.
- Loads the user's membership for that scope once per request. No membership or `suspended` → 403.
  Sets `ctx.membership` (`{ scopeId, userId, role, status }`). No cross-request cache.
- Routes without a selected scope (scope creation, "my scopes", join flows, the session payload before
  a scope is chosen) omit it and treat the membership as null. No `optional` mode. **[owner]**

**Bouncer:**

- The app's existing `initialize_bouncer_middleware` builds Bouncer once, as today, and merges in the
  package's abilities from a request-aware factory, e.g. `ac.abilities(() => ctx.membership)`. The
  resolver, policies, container resolver and Edge helpers stay as the app set them. The scope middleware
  never rebuilds `ctx.bouncer`.
- Each ability reads the membership lazily when it runs, and denies when there is no membership, when
  it is not `active`, or when `membership.userId` does not match the Bouncer subject's id. That last
  check stops the abilities being reused with `new Bouncer(otherUser, …)` to grant the request
  actor's privileges.
- Types: the app's ability and client key/role types derive from the configured instance, so the
  `HttpContext` augmentation sees the package abilities.
- Edge: `@can('project:write')` treats a dotted name as a policy method, so templates call the Bouncer
  instance's `allows` for permission keys.
- Rejected: rebuilding `ctx.bouncer` in the scope middleware (stale Edge helpers, lost resolver,
  undeclared ability types); relying on async local storage as a prerequisite.
- The spike confirms this with alternate subjects, concurrent requests in different scopes, the kit's
  managed guards and masqueraded reads. A user-keyed WeakMap and passing the membership as an explicit
  ability argument remain fallbacks only.

### 7.8 Account Kit integration [review]

Account Kit is a required peer (D5). The package ships ready-made callbacks for the kit's config.

Hooks, with corrected citations in `oss-adonisjs-account-kit` at `8a60eee`: **[repo]**

| Kit hook                                                                                                                | Package use                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authorize.invite(actor, role, context?)` (`src/types_foundation.ts:203`; `context` is `{ trx? }`; scope added by #768) | actor has `invitations:manage` in the invitation's scope and may assign `role`. Send calls it first without context, then rechecks inside the insert transaction with `{ trx }`; the recheck must use that `trx`.                                                                                                                                                                                                                                   |
| `authorize.manageInvitation`                                                                                            | same, against the stored invitation                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `authorize.listInvitations`                                                                                             | allows when the actor has `invitations:manage` in the requested scope. Relies on #768 making both the callback and the list query scope-aware; today the kit authorizes once and then queries every unexpired invitation (`src/invitation_management.ts:155`), so this must be re-checked against #768 as merged.                                                                                                                                   |
| `onInvitationAccepted(user, invitation, trx)` (`src/types_configuration.ts:42`)                                         | calls the trusted `acceptInvitation` with `invitation.scope` and `invitation.role`; with #768 it runs once per pending invitation for the address. Also fires from `src/invitation_match.ts` (social registration, activation, a reset that confirms a never-confirmed account), so it must behave the same on those paths. With admission evidence on, compose as `withInvitationEvidence(<package callback>)` and keep any existing app callback. |
| `onAccountDeletingTransaction(user, trx)` (`src/types_configuration.ts:139`)                                            | refuses deletion of a last owner, under the scope-row lock. Membership rows are removed by the `user_id` cascade, not by the hook.                                                                                                                                                                                                                                                                                                                  |
| `exportAccountData(user, trx)` (`src/types_configuration.ts:133`)                                                       | adds the user's memberships to their data export                                                                                                                                                                                                                                                                                                                                                                                                    |

- Invitation authorization callbacks also check that the actor is admitted when admission is enabled.
- Accepting an invitation creates a membership but does not by itself admit the user to product routes.

**Invitations:** #768 is presumed done, so invitations carry `scope` and a plain role. There is no
encoded `<scopeId>:<role>` form, no codec and no legacy decoder. **[owner]**

### 7.9 Client payload

A typed helper the app can return from its "who am I" or session endpoint:

```ts
{
  scopeId: '42',
  role: 'editor',
  permissions: ['project:read', 'project:write'],
  assignableRoles: [], // non-managers get none
}
```

Before a scope is selected the payload's membership is `null`. The frontend does
`import type { PermissionKey, Role } from '...'` and checks `payload.permissions.includes('project:write')`.
The server re-checks every request.

### 7.10 Setup

- `node ace configure @kevinjohn/adonisjs-access-control`: creates `config/access_control.ts`, publishes
  the memberships migration and registers the provider and middleware.
- The configure step derives the physical users table and key type from Account Kit's users adapter
  metadata, and asks for the scope table and key type. **[review]**
  (`usersTable` at `src/types_configuration.ts:77`; adapter `table` metadata in `src/types_foundation.ts`.)
- Follows Account Kit's setup conventions where practical.

### 7.11 Testing

- Unit: rank, `can`, assignable roles, config validation, every management rule including owner, self
  role and self status cases, and the identity predicate's empty and self cases.
- Database, on SQLite, PostgreSQL and MySQL (matching Account Kit's matrix): unique constraints;
  **concurrent first-member creation on an empty scope [review]**; last-owner protection under
  concurrent transactions; transfer atomicity; package-owned, caller-owned and Account Kit hook
  transactions tested separately **[review]**.
- Integration: Bouncer abilities through a real request; alternate Bouncer subjects; concurrent requests
  in different scopes **[review]**; middleware refusal for non-members and suspended members; Account
  Kit hooks inside kit transactions, including the `invitation_match` acceptance paths and one address
  invited to two scopes; a custom users
  table **[review]**.
- Every fix and test mutation-checked, as in the sibling repositories.

---

## 8. Non-goals for v1

- Custom or runtime-defined roles; roles table; role editing UI.
- Several roles per member.
- Record-level rules (stay in Bouncer policies).
- Attribute-based access control.
- Admin UI of any kind.
- Per-scope rate limits.
- Scope (team) CRUD.
- A browser-side copy of the rules.

## 9. Later candidates

- `aliases` and `inactive` permission keys for renames and retirement.
- `scopeTo(tokenAbilities)`: narrow permissions to an Account Kit access token's abilities.
- Inviting an existing account into another scope (follow-up to #768).
- A "join scope" flow for admitted users without a membership (CapacityLens has one).
- Masquerade integration: masquerade already blocks writes; confirm abilities evaluate the masqueraded
  member's role for reads.

## 10. Open questions

None. The Bouncer spike passed on 2026-11-05 (build spec section 13): the request-aware factory works,
and permission keys use `resource:action` because Edge's `@can` splits dotted names into policy calls.

Settled by the owner after review: Account Kit stays required (D5); no database-specific owner
indexes, one locking process; #768 presumed done (no codec, scoped managed listing); suspended
memberships count in the identity rule; no optional middleware mode; `members:list` required.
Settled from the code: admission middleware ordering (7.7).

## 11. Next steps

1. When the owner says go: create `Kevinjohn/oss-adonisjs-access-control` (visibility to confirm) and
   record this design as its first issue.
2. Spike the Bouncer wiring (open question 1).
3. Build the core, transaction runner, memberships and middleware, then the Account Kit callbacks on
   #768's invitation `scope`.
4. Re-check the 7.8 hook rows against #768 as merged.
5. Later, CapacityLens can adopt the package when it goes multi-company.

## 12. Adversarial review (2026-11-05)

Two independent read-only reviews of this document, then one consensus round in which each reviewer
voted on every finding from both. Only changes both reviewers accepted were applied; the rest are in
section 10. Working files: `/tmp/ac-review/` (round-1 findings, round-2 votes, pre-consensus copy).

- Reviewers: two independent high-effort reviewers, with 12 and 13 findings respectively. Neither rejected any finding outright; overlaps were merged.
- Applied, both reviewers agreeing:
  1. Scope-row lock before every invariant check, covering the empty-scope first-owner race (7.6).
  2. Package-owned transaction runner; optional `trx` with a stated contract (7.4).
  3. ~~Account Kit becomes an optional peer behind `/account-kit`~~ (overruled: owner kept it required, D5).
  4. `managerRole` removed; reserved permission keys are the one authority source (7.1, 7.5).
  5. Active actor membership re-read in every management write; own-role change forbidden; equal-rank
     management stated; no last-manager guarantee without an owner (7.4, 7.5).
  6. Identity predicate: empty target denies, self needs a non-empty map, transaction-scoped enforcement
     (7.5).
  7. Bouncer built once in the app's initializer with a request-aware ability factory; subject id check;
     Edge dotted-key note (D8, 7.7).
  8. Admission enforced before scope checks and inside invitation callbacks; route-scoped middleware
     (7.7, 7.8).
  9. Trusted `createFirstMember` and `acceptInvitation` operations (7.4).
  10. ~~Managed invitation list denied before #768~~ (moot after the owner presumed #768 done).
  11. ~~Bounded pre-#768 codec~~ (moot after the owner presumed #768 done).
  12. Config validation and a deployment contract for role changes (7.1, D2).
  13. Fixed `increments` id; users table and key type configured, not assumed (7.3, 7.10).
  14. Account Kit hook citations, call paths and `withInvitationEvidence` composition corrected; the
      deletion hook no longer deletes rows (7.8).
  15. Section 4.3's owner-index claim relabelled as an unverified code comment.
  16. D12's "MySQL lock-only" default replaced by the scope-row lock.

Owner rulings after the review: #768 presumed done; "MySQL is a choice the owner makes. We code for
process, not DB choice."; Account Kit stays required; suspended memberships count; no optional
middleware mode; `members.list` required.

## 13. Sources

- Account Kit #768: https://github.com/Kevinjohn/oss-adonisjs-account-kit/issues/768
- holoyan source: https://github.com/holoyan/adonisjs-permissions
- holoyan on npm: https://npmjs.com/package/@holoyan/adonisjs-permissions
- AdonisJS Plus permissions docs: https://plus.adonisjs.com/docs/packages/permissions/introduction
  (and `/quick-start`, `/defining-permissions`, `/access-control`, `/team-permissions`,
  `/bouncer-integration`)
- AdonisJS Plus terms: https://plus.adonisjs.com/terms
- AdonisJS blog, Persona and Permission: https://adonisjs.com/blog/introducing-persona-and-permission
