# Adopting the package over an existing memberships table

An application that already stores team memberships keeps its table and moves the rows into the
package's table once; the package never reads the old table. The steps run in one deployment.

## 1. Configure a separate table

Run `configure` with a table name the application does not use, and the key types of your users
and scope tables:

```sh
node ace configure @kevinjohn/adonisjs-access-control --scope-table=teams --memberships-table=team_memberships
```

Map your role names onto `roles` in `config/access_control.ts`, lowest first. A role the old
table uses that is missing from the tuple makes its members unknown after the switch; add it or
map it in the copy below.

## 2. Copy the rows

Write an application migration that runs after the published
`*_access_control_create_memberships.ts` one. It reads the old table and inserts one row per
member, mapping the old team column to `scope_id`, the old user column to `user_id`, the old role
name to a name in `roles`, and the old state to `active` or `suspended`:

```ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      const now = new Date()
      const old = await db.from('memberships').select('team_id', 'user_id', 'role', 'disabled')
      for (const row of old) {
        await db.table('team_memberships').insert({
          scope_id: row.team_id,
          user_id: row.user_id,
          role: row.role === 'manager' ? 'admin' : row.role,
          status: row.disabled ? 'suspended' : 'active',
          created_at: now,
          updated_at: now,
        })
      }
    })
  }

  async down() {
    this.defer(async (db) => {
      await db.from('team_memberships').delete()
    })
  }
}
```

Keep one row per `(scope_id, user_id)`; the unique key refuses duplicates. With `ownerRole` set,
give every scope exactly one active owner in the same migration; the rules refuse a second one
later and the doctor reports scopes without one.

## 3. Verify and switch

```sh
node ace migration:run
node ace access-control:doctor
```

A clean doctor run means every copied row has a known role and status, a scope and a user, and
one owner per scope. Then route the scoped requests through the `scope` middleware and the
generated abilities as the [Bouncer guide](bouncer.md) shows, and stop writing to the old table:
every change goes through the membership service from now on, so `onMembershipChanged` sees it.
Drop the old table in a later release once nothing reads it.

## Replacing a home-grown access layer

An application that enforced roles in its own code before adopting the package gains most by
deleting that code, not by wrapping it.

Delete:

- Local action vocabularies and the tables that translate them to roles. Permission keys replace
  them.
- Policies that re-check a role the generated abilities already check.
- Local self, owner and rank checks in front of package calls. The package refuses those cases
  with `SELF_MANAGEMENT`, `OWNER_PROTECTED` and `RANK_TOO_LOW`.
- Extra permission payloads for the client. Use the [client payload](client.md) or
  [one shared declaration](../recipes/index.md#share-one-permission-declaration-with-the-browser).

Keep in the application:

- Audit rows, revision counters and idempotency receipts, written through the same `trx`.
- Product rules stricter than the package, each a line beside the package call
  ([recipe](../recipes/index.md#a-product-rule-stricter-than-the-package)).
- The mapping from package errors to the application's API
  ([recipe](../recipes/index.md#map-package-errors-to-your-api)).

An application with no released database can skip the copy above and start from a fresh
baseline. Create the package's table in the baseline migration with exactly the shape of the
published `*_access_control_create_memberships.ts`: the same columns, types, foreign keys, unique
key and indexes, then delete the published file. Run `node ace access-control:doctor` against the
fresh database; it checks the table and its columns, not types or indexes, so copy the published
body rather than retyping it. A later `configure` run publishes any released migration whose file
name is missing, so delete that file again after re-running it.

[Capacity Lens](https://github.com/Kevinjohn/capacitylens) moved from its own access layer to the
package this way. Its first attempt spread over four pull requests that added 3,409 lines and
removed 2,162; they were closed. A second plan that said what not to carry over produced one change of +1,092/−3,671
([#1787](https://github.com/Kevinjohn/capacitylens/pull/1787)).
