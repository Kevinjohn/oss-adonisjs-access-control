# Access Control for AdonisJS

[![checks](https://github.com/Kevinjohn/oss-adonisjs-access-control/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/Kevinjohn/oss-adonisjs-access-control/actions/workflows/checks.yml)
[![Node.js 24+](https://img.shields.io/badge/node-%3E%3D24-339933)](package.json)
[![AdonisJS 7](https://img.shields.io/badge/AdonisJS-7-5a45ff)](https://adonisjs.com)

> Pre-release. Installed from GitHub releases; not on npm.

## What you get

Access Control adds team memberships and a ranked role matrix to an AdonisJS 7 application built
on Account Kit. It sits between identity (Account Kit) and record-level rules (your Bouncer
policies).

- Roles and `resource:operation` permission keys declared in code, checked at compile time.
- Memberships per team with a role and a status, with the management rules enforced in one
  locking process on every database.
- Optional owner role with atomic ownership transfer.
- Scope middleware and generated Bouncer abilities for the current request's membership.
- Account Kit callbacks for scoped invitations, account deletion and data export.

## Install

Access Control requires Node.js 24+, AdonisJS 7 and Account Kit 0.8.0 (`^0.8.0` peer range), the release with
the `./transaction` export, scoped invitations and `ctx.auth.user` left set by its middleware.
For a registry-published package, `node ace add @kevinjohn/adonisjs-access-control --package-manager=pnpm`
would install and configure it. Access Control ships as a GitHub release archive, and Ace uses
the add argument as the module name for its configure step. Install the archive with pnpm, then
configure it by package name.

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-access-control/releases/download/v0.4.1/kevinjohn-adonisjs-access-control-0.4.1.tgz
node ace configure @kevinjohn/adonisjs-access-control --scope-table=teams
```

The release asset is `kevinjohn-adonisjs-access-control-0.4.1.tgz`; verify it against the SHA-256
in the [release notes](https://github.com/Kevinjohn/oss-adonisjs-access-control/releases/tag/v0.4.1).

## What configure changes

Configure writes `config/access_control.ts`, publishes the memberships migration and registers
the provider and the Ace command loader in `adonisrc.ts`. It also registers the named `scope`
middleware in `start/kernel.ts`. The command prints the remaining Bouncer and Account Kit wiring
steps. It skips existing configuration and migration files.

## Configuration

```ts
// config/access_control.ts (written by configure)
import { defineAccessControl } from '@kevinjohn/adonisjs-access-control'

export default defineAccessControl({
  roles: ['viewer', 'editor', 'admin', 'owner'],
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  permissions: {
    project: { read: 'viewer', write: 'editor' },
    members: { list: 'admin', manage: 'admin' },
    invitations: { manage: 'admin' },
  },
})
```

## Usage

```ts
// start/routes.ts: Account Kit's middleware (credential revision, active account or admission)
// runs before `scope`; `middleware.auth()` alone skips those checks.
router
  .put('/teams/:scopeId/projects/:id', [ProjectsController, 'update'])
  .use([kitAccount, middleware.scope()])
// in the controller
await bouncer.authorize('project:write')
```

`kitAccount` is the kit's `managedAccountMiddleware` (or `admissionMiddleware`) built once in
`start/routes.ts`; the [Bouncer guide](docs/guide/bouncer.md) shows it. Build the request's
Bouncer from `#config/access_control`, not from `services/main`, so permission keys are typed.

The [getting started guide](docs/guide/getting-started.md) walks from install to this route and
the first member; the [setup guide](docs/guide/setup.md) covers the two manual steps (the Bouncer
initializer and the Account Kit callbacks) and `node ace access-control:doctor`.

## Documentation

- [Getting started](docs/guide/getting-started.md): install and protect a first scoped route.
- [Guides](docs/README.md#guides): setup, roles, rules, memberships, Bouncer, Account Kit, the
  client membership summary, changing roles and adoption.
- [Recipes](docs/recipes/index.md): team creation and deletion, members pages, error mapping,
  single-scope applications and more.
- [API reference](docs/reference/README.md): supported imports and generated signatures.
- [Errors](docs/reference/errors.md): every error code, its status and whether a user can reach it.
- [Troubleshooting](docs/guide/troubleshooting.md): common symptoms, causes and fixes.
- [Technical contract](docs/maintainers/design/spec-access-control.md)
- [Notes for coding agents](README-AGENTS.md)

## Errors

Handle a specific refusal through the root `errors` namespace.

```ts
import { errors } from '@kevinjohn/adonisjs-access-control'

if (error instanceof errors.E_ACCESS_CONTROL_FORBIDDEN) {
  // Render the application's permission-denied response.
}
```

AdonisJS renders uncaught package exceptions with their HTTP status and
`{ errors: [{ code, message }] }`. See the [error reference](docs/reference/errors.md) for codes
and translation keys.

## Tested against

|                         | Every pull request | Weekly, matching PRs, and manual runs   |
| ----------------------- | ------------------ | --------------------------------------- |
| Node.js                 | 24                 | 24                                      |
| AdonisJS core           | locked version     | lowest supported (7.0.0) and latest 7.x |
| Lucid                   | locked version     | lowest supported and latest 22.x        |
| SQLite (better-sqlite3) | yes                | yes                                     |
| PostgreSQL 16           | yes                | yes                                     |
| MySQL 8.4               | yes                | no                                      |

## User stories

See the [user story catalogue](user-stories/README.md) for source-reviewed roles, scope enforcement, membership lifecycle, Account Kit callbacks and operator setup.

## Contributing

Bug reports and documentation fixes are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE.md)
