# Access Control for AdonisJS

[![checks](https://github.com/Kevinjohn/oss-adonisjs-access-control/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/Kevinjohn/oss-adonisjs-access-control/actions/workflows/checks.yml)
[![Node.js 24+](https://img.shields.io/badge/node-%3E%3D24-339933)](package.json)
[![AdonisJS 7](https://img.shields.io/badge/AdonisJS-7-5a45ff)](https://adonisjs.com)

> Pre-release. Installed from GitHub releases; not on npm.

## What you get

Access Control adds team memberships and a ranked role matrix to an AdonisJS 7 application built
on Account Kit. It sits between identity (Account Kit) and record-level rules (your Bouncer
policies).

- Roles and `resource:action` permission keys declared in code, checked at compile time.
- Memberships per team with a role and a status, with the management rules enforced in one
  locking process on every database.
- Optional owner role with atomic ownership transfer.
- Scope middleware and generated Bouncer abilities for the current request's membership.
- Account Kit callbacks for scoped invitations, account deletion and data export.

## Install

Access Control requires Node.js 24+, AdonisJS 7 and Account Kit. Install the `0.1.0` release
from GitHub:

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-access-control/releases/download/v0.1.0/kevinjohn-adonisjs-access-control-0.1.0.tgz
node ace configure @kevinjohn/adonisjs-access-control --scope-table=teams
```

The release asset is `kevinjohn-adonisjs-access-control-0.1.0.tgz`; verify it against the SHA-256
in the [release notes](https://github.com/Kevinjohn/oss-adonisjs-access-control/releases/tag/v0.1.0).

## Quick example

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
})
```

```ts
router
  .put('/teams/:scopeId/projects/:id', [ProjectsController, 'update'])
  .use([middleware.auth(), middleware.scope()])
// in the controller: await bouncer.authorize('project:write')
```

## Tested against

|                         | Every pull request | Weekly and before each release          |
| ----------------------- | ------------------ | --------------------------------------- |
| Node.js                 | 24                 | 24                                      |
| AdonisJS core           | locked version     | lowest supported (7.0.0) and latest 7.x |
| Lucid                   | locked version     | lowest supported and latest 22.x        |
| SQLite (better-sqlite3) | yes                | yes                                     |
| PostgreSQL 16           | yes                | yes                                     |
| MySQL 8.4               | yes                | no                                      |

## Documentation

- [Documentation index](docs/README.md)
- [API reference](docs/reference/README.md)
- [Technical contract](docs/maintainers/design/spec-access-control.md)
- [Notes for coding agents](README-AGENTS.md)

## Contributing

Bug reports and documentation fixes are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE.md)
