# Access Control with Account Kit: API example

This app is Account Kit's
[API example](https://github.com/Kevinjohn/oss-adonisjs-account-kit/tree/v0.3.1/examples/api)
at `v0.3.1`, with Access Control added. Accounts create teams, invite members to a team with a
role, and each role sees and changes only what its permission keys allow. It runs on the official
AdonisJS API starter at
[`adonisjs/starter-kits` revision `46d235932e3eb6472a16b740fa0b47b5f69fc6fc`](https://github.com/adonisjs/starter-kits/tree/46d235932e3eb6472a16b740fa0b47b5f69fc6fc/api).
Everything Account Kit's README describes still applies.

## What this example adds

| File                                                                                      | Shows                                                                                        |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `config/access_control.ts`                                                                | Roles `viewer`, `editor`, `admin`, `owner` and the permission keys `team:read`, `team:write` |
| `database/migrations/1800000001003_create_teams_table.ts`, `app/models/team.ts`           | The `teams` table: the scope memberships belong to                                           |
| `database/migrations/1800000002003_access_control_create_memberships.ts`                  | Access Control's memberships table                                                           |
| `config/account_kit.ts`, `app/services/account_kit_authorization.ts`                      | Access Control's callbacks authorise and accept invitations                                  |
| `app/services/account_kit_export.ts`                                                      | The data export adds the account's team memberships                                          |
| `app/validators/account_kit.ts`, `app/controllers/invitations_controller.ts`              | Invitations and their list carry a team `scope`                                              |
| `app/middleware/initialize_bouncer_middleware.ts`, `app/abilities/main.ts`, `adonisrc.ts` | Bouncer, with one generated ability per permission key                                       |
| `start/kernel.ts`, `start/routes.ts`, `app/controllers/teams_controller.ts`               | `POST /api/v1/teams`, and `GET`/`PATCH /api/v1/teams/:scopeId` behind the `scope` middleware |

Account Kit's example kept every role in its own `role_assignments` table. Team roles now live in
Access Control. The table keeps only the two instance-wide roles Access Control has no equivalent
for: `owner`, who decides admissions and inspects accounts, and `disabled`, which Account Kit's
`canAccess` refuses.

`node ace configure @kevinjohn/adonisjs-access-control --scope-table=teams` and
`node ace configure @adonisjs/bouncer` generated the starting files. `compatibility/` from
Account Kit's example is left out: it is Account Kit's own test harness.

## Install and run

Use Node 24 and pnpm 11.23.0. From the Access Control repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir examples/with_account_kit/api kit:pack
cd examples/with_account_kit/api
pnpm install --no-frozen-lockfile
cp .env.example .env
pnpm exec node ace generate:key --force
pnpm exec node ace migration:run
pnpm dev
```

`kit:pack` builds Access Control from this checkout into `vendor/`. Account Kit comes from its
`v0.3.1` GitHub release. The packed archive's checksum changes with every build, so the install
does not use a frozen lockfile.

## Create a team and invite a member

An admitted account creates a team and becomes its owner:

```sh
curl -X POST http://localhost:3333/api/v1/teams -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Rockets"}'
```

Team owners and admins invite with the team id as `scope`:

```sh
curl -X POST http://localhost:3333/api/v1/account/invitations -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"email":"viewer@example.com","role":"viewer","scope":"1"}'
```

Accepting the invitation creates the account and its membership. A viewer can
`GET /api/v1/teams/1`; `PATCH` needs `editor` and is otherwise refused with
`E_AUTHORIZATION_FAILURE` (403); a non-member gets `E_ACCESS_CONTROL_FORBIDDEN` (403).

## Checks

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
```

`tests/functional/teams.spec.ts` covers the team routes. The invitation, admission and release
specs send team-scoped invitations and read the resulting memberships.
