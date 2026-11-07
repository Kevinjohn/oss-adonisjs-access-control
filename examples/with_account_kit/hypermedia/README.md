# Access Control with Account Kit: Hypermedia example

This app is Account Kit's
[Hypermedia example](https://github.com/Kevinjohn/oss-adonisjs-account-kit/tree/v0.3.1/examples/hypermedia)
at `v0.3.1`, with Access Control added. Accounts create teams, invite members to a team with a
role, and each role sees and changes only what its permission keys allow. It runs on the official
AdonisJS Hypermedia starter at
[`adonisjs/starter-kits` revision `46d235932e3eb6472a16b740fa0b47b5f69fc6fc`](https://github.com/adonisjs/starter-kits/tree/46d235932e3eb6472a16b740fa0b47b5f69fc6fc/hypermedia).
Everything Account Kit's README describes still applies.

## What this example adds

| File                                                                                      | Shows                                                                                           |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `config/access_control.ts`                                                                | Roles `viewer`, `editor`, `admin`, `owner` and the permission keys `team:read` and `team:write` |
| `database/migrations/1792342558358_create_teams_table.ts`, `app/models/team.ts`           | The `teams` table: the scope memberships belong to                                              |
| `database/migrations/1792342559358_access_control_create_memberships.ts`                  | Access Control's memberships table                                                              |
| `database/migrations/179234256*_account_kit_*account_invitations.ts`                      | Account Kit's invitations table, with a scope per invitation                                    |
| `config/account_kit.ts`                                                                   | Invitations enabled; Access Control's callbacks authorise and accept them                       |
| `app/middleware/initialize_bouncer_middleware.ts`, `app/abilities/main.ts`, `adonisrc.ts` | Bouncer, with one generated ability per permission key                                          |
| `start/kernel.ts`, `start/routes.ts`                                                      | The `scope` middleware on every `/teams/:scopeId` route                                         |
| `app/controllers/teams_controller.ts`, `team_invitations_controller.ts`                   | Create a team, show it, rename it (`team:write`), invite a member                               |
| `app/controllers/invitations_controller.ts`, `app/services/token_page_headers.ts`         | The invitation link: choose a password, create the account and join                             |
| `resources/views/pages/teams/*.edge`, `pages/auth/accept_invitation.edge`                 | The teams pages, the invitation page and a **Teams** link in the app layout                     |

`node ace configure @kevinjohn/adonisjs-access-control --scope-table=teams` and
`node ace configure @adonisjs/bouncer` generated the starting files.

## Install and run

Use Node 24 and pnpm 11.23.0. From the Access Control repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir examples/with_account_kit/hypermedia kit:pack
cd examples/with_account_kit/hypermedia
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

1. Create an account at `/signup`, confirm the address from the link in the server log, and sign
   in. Teams send invitation email, so they need a confirmed address.
2. Open **Teams**, enter a name and choose **Create team**. You are its owner.
3. On the team page, invite an address as `viewer`, `editor` or `admin`. In development the
   invitation email, link included, is printed to the server log.
4. Open the link in another browser, choose a password and sign in as the new member.
5. A viewer sees the team and its members; an editor can also rename it; an admin can also
   invite. Anyone outside the team gets `E_ACCESS_CONTROL_FORBIDDEN` (403).

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

`tests/functional/teams.spec.ts` covers creating a team, inviting and joining, a viewer who reads
but is refused a rename with `E_AUTHORIZATION_FAILURE`, an editor who renames, a refused outsider,
an unconfirmed account that cannot create a team, and an editor who cannot invite.
`tests/browser/teams.spec.ts` creates and renames a team in Chromium.
