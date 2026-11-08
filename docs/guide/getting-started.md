# Getting started

This page takes an AdonisJS 7 application from install to one scoped route that only team members
with the right role can use. It uses a `teams` table with integer keys; the
[setup guide](setup.md) lists the flags for other tables and key types. The
[API example](https://github.com/Kevinjohn/oss-adonisjs-access-control/tree/main/examples/with_account_kit/api)
runs the same steps end to end.

## Before you start

- Node.js 24 and AdonisJS 7 with Lucid and Bouncer installed.
- Account Kit 0.3.3 configured: `config/account_kit.ts` exists and the kit's migrations have run,
  including its `account_transaction_lock` table.
- A users table and a `teams` table, each with an `increments()` primary key.

## 1. Install and configure

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-access-control/releases/download/v0.1.5/kevinjohn-adonisjs-access-control-0.1.5.tgz
node ace configure @kevinjohn/adonisjs-access-control --scope-table=teams
```

`configure` writes `config/access_control.ts`, publishes the memberships migration, registers the
provider, the doctor command and the named `scope` middleware. It then prints two changes for you
to make by hand:

- Merge the generated abilities into the request's Bouncer in
  `app/middleware/initialize_bouncer_middleware.ts`, as the
  [Bouncer guide](bouncer.md#generated-abilities) shows.
- Pass the package callbacks to Account Kit in `config/account_kit.ts`, as the
  [Account Kit guide](account-kit.md#wiring) shows.

## 2. Migrate

```sh
node ace migration:run
```

The published migration creates the `memberships` table with foreign keys to `users` and `teams`.

## 3. Run the doctor

```sh
node ace access-control:doctor
```

Each check prints its name and a count. On a new install every count is 0 and the command exits
with code 0. A non-zero count or exit code is explained in
[troubleshooting](troubleshooting.md#the-doctor-reports-a-problem).

## 4. Define your roles and permission keys

Edit `config/access_control.ts` now, before the first membership exists. Once rows store a role
name, renaming or removing that role is a data migration
([changing roles](changing-roles.md)).

```ts
export default defineAccessControl({
  roles: ['viewer', 'editor', 'admin', 'owner'],
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  membershipsTable: 'memberships',
  permissions: {
    project: { read: 'viewer', write: 'editor' },
    members: { list: 'admin', manage: 'admin' },
    invitations: { manage: 'admin' },
  },
})
```

Roles run lowest first; each key names the lowest role allowed. `members:list`, `members:manage`
and `invitations:manage` are required, and the application refuses to boot with
`E_ACCESS_CONTROL_INVALID_CONFIG` when the declaration is invalid. The
[roles guide](roles.md) has the full rules.

## 5. Protect a route

Put Account Kit's middleware first, then `middleware.scope()`, then check a permission key in the
controller:

```ts
// start/routes.ts
router
  .put('/teams/:scopeId/projects/:id', [ProjectsController, 'update'])
  .use([kitAccount, middleware.scope()])
```

```ts
// app/controllers/projects_controller.ts
export default class ProjectsController {
  async update({ bouncer }: HttpContext) {
    await bouncer.authorize('project:write')
    // ...
  }
}
```

`kitAccount` is the kit's `managedAccountMiddleware`, built once in `start/routes.ts`; the
[Bouncer guide](bouncer.md#the-scope-middleware) shows it. The scope middleware loads the
caller's membership of `:scopeId` and refuses a non-member, a suspended member or a malformed key
with `E_ACCESS_CONTROL_FORBIDDEN` (403). `bouncer.authorize('project:write')` then refuses a
viewer with Bouncer's `E_AUTHORIZATION_FAILURE` (403) and lets an editor, admin or owner through.

## 6. Create the first member

A new team has no members, so nobody passes the scope middleware yet. Create the team and its
owner in one transaction, on a route without the scope middleware:

```ts
import db from '@adonisjs/lucid/services/db'
import { transaction } from '@kevinjohn/adonisjs-account-kit/transaction'
import accessControl from '#config/access_control'

const team = await transaction(db, async (trx) => {
  const created = await Team.create({ name }, { client: trx })
  await accessControl.memberships.createFirstMember({ scopeId: created.id, userId: user.id, trx })
  return created
})
```

With `ownerRole` set the first member is the owner. Start the transaction with Account Kit's
runner, not `db.transaction()`; the [memberships guide](memberships.md#transactions-and-locks)
says why. The creator can now call `PUT /teams/<id>/projects/<id>`. Further members join through
[Account Kit invitations](account-kit.md#invitations) or `memberships.add`.

## Next steps

- [Management rules](rules.md): who may change, suspend, remove or leave.
- [Client payload](client.md): what the frontend receives about the current member.
- [Recipes](../recipes/index.md): members pages, team deletion, error mapping and more.
- [Troubleshooting](troubleshooting.md): symptoms, causes and fixes.
