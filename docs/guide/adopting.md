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
