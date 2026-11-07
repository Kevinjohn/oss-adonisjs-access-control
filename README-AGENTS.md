# Access Control: notes for coding agents

Use these notes to assess Access Control and protect its guarantees. Human overview: [README](https://github.com/Kevinjohn/oss-adonisjs-access-control#readme). Links work from `node_modules`.

## Fit check

- AdonisJS 7 on Node.js 24+ with SQLite, PostgreSQL or MySQL, using Account Kit for identity and
  Bouncer for record-level rules. The app owns its users and teams tables; the package owns
  memberships and the role matrix.

## Requirements

Core 7, Lucid 22.4.2+, Bouncer 4, Auth 10, Luxon 3 and Account Kit 0.3.1 (exact), the release
with the `./transaction` export, scoped invitations and `ctx.auth.user` after its middleware.
Roles and permission keys are declared in `config/access_control.ts`.

## Install

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-access-control/releases/download/v0.1.2/kevinjohn-adonisjs-access-control-0.1.2.tgz
node ace configure @kevinjohn/adonisjs-access-control --scope-table=teams
node ace migration:run
node ace access-control:doctor
```

`configure` writes `config/access_control.ts`, publishes the memberships migration, registers the
provider, the commands and the named `scope` middleware, and prints the Bouncer initializer and
Account Kit config changes to apply by hand. Flags: `--scope-id-type`, `--users-table`,
`--user-id-type`, `--memberships-table`.

## Capabilities

- Ranked roles with an optional owner role; `resource:action` permission keys with the lowest
  role allowed.
- Memberships per scope with `active` or `suspended` status, actor-authorised management, owner
  transfer, and trusted operations for first members and accepted invitations.
- Scope middleware, generated Bouncer abilities, Account Kit callbacks and a client payload.

## Invariants: do not break these

1. Lock in the order of specification section 4.2 only; ascending is code-unit order of
   `String(key)`.
2. Keep `members:list`, `members:manage` and `invitations:manage` present; abilities resolve the
   membership lazily and deny on a missing, inactive or other-subject membership.
3. Released migration stubs never change; error codes stay `E_ACCESS_CONTROL_*`.

## Testing an application

Create the kit's `account_transaction_lock` row, a users table and a scope table in the test
database; every service method accepts a caller `trx` started by the kit's `transaction()`.

## Source map

- `src/`: configuration, rules, membership service, locks, errors and payload.
- `middleware/`, `account_kit/`, `providers/`, `services/`, `commands/`, `stubs/`: exported
  subpaths, provider, container service, Ace commands and configure templates.

## Further reading

- [Guides](https://github.com/Kevinjohn/oss-adonisjs-access-control/blob/main/docs/guide/setup.md):
  setup, roles, rules, memberships, Bouncer, Account Kit, client payload, changing roles.
- [Technical contract](https://github.com/Kevinjohn/oss-adonisjs-access-control/blob/main/docs/maintainers/design/spec-access-control.md).

## Tested against

|                         | Every pull request | Weekly and before each release          |
| ----------------------- | ------------------ | --------------------------------------- |
| Node.js                 | 24                 | 24                                      |
| AdonisJS core           | locked version     | lowest supported (7.0.0) and latest 7.x |
| Lucid                   | locked version     | lowest supported and latest 22.x        |
| SQLite (better-sqlite3) | yes                | yes                                     |
| PostgreSQL 16           | yes                | yes                                     |
| MySQL 8.4               | yes                | no                                      |
