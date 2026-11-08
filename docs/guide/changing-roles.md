# Changing roles and checking the database

Roles are stored by name, so a change to the role tuple or the owner role is a deployment with a
data migration. The doctor command checks the memberships table before and after.

## The doctor

```sh
node ace access-control:doctor [--scope=<id>] [--json]
```

A read-only check of the memberships table against `config/access_control.ts`. Each check
reports a count and up to 20 sample ids, never names or emails. `--scope` limits the row checks to
one scope. `--json` prints `{ "checks": [{ "name", "ok", "count", "sampleIds" }] }`.

| Check                    | Finds                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `memberships_table`      | A missing table, or missing columns (listed in `sampleIds`).                           |
| `unknown_role`           | Memberships whose role is not in `roles`.                                              |
| `unknown_status`         | Memberships whose status is neither `active` nor `suspended`.                          |
| `scope_without_owner`    | With `ownerRole` set: scopes that have members but no active owner.                    |
| `scope_with_many_owners` | With `ownerRole` set: scopes with more than one active owner.                          |
| `orphan_scope`           | Memberships whose scope row is gone (possible only without the foreign keys).          |
| `orphan_user`            | Memberships whose user row is gone.                                                    |
| `account_kit_version`    | The installed Account Kit version differs from the exact version this package expects. |

Exit code 0 when every check is clean, 1 when a check finds rows, 2 when a check could not run
(for example a malformed `--scope`). The command writes nothing and takes no locks.

### Run it in CI

Run the doctor wherever the application starts against a real schema: after `migration:run` in
CI, or in a smoke test of the packaged application. It starts the application, so it needs the
same environment and database connection.

```sh
node ace migration:run
node ace access-control:doctor --json
```

Fail the job on any non-zero exit code. 1 means a check found rows, including
`account_kit_version` when the installed Account Kit is not the exact version this release
expects; 2 means a check could not run, for example an unreachable database. `--json` prints the
report on one line for a log or an artefact; when the doctor cannot run it prints an error line
instead. Rows are reported as ids only, never names or emails.

## Rename a role

1. Change the name in `roles` (and in `ownerRole` when it is the owner).
2. In one application migration, rewrite the stored names in the memberships table and in
   pending Account Kit invitations:

   ```sql
   UPDATE memberships SET role = 'maintainer' WHERE role = 'editor';
   UPDATE account_invitations SET role = 'maintainer' WHERE role = 'editor';
   ```

3. Deploy the configuration and the migration together.
4. Run the doctor: `unknown_role` must be 0.

## Remove a role

Move its members to another role first with the same migration shape, then remove the name from
`roles`. Until the migration runs, members with the removed role are refused everywhere.

## Turn the owner role on later

1. Run the doctor with the new configuration in a dry run: `scope_without_owner` lists every scope
   that needs an owner.
2. Assign one owner per scope with an application migration, choosing by your own rule (for
   example the earliest active member with the highest role).
3. Set `ownerRole` and deploy.
4. Run the doctor again before relying on the owner rules: `scope_without_owner` and
   `scope_with_many_owners` must both be 0.

## Turn the owner role off

Remove `ownerRole`. The stored owner rows keep their role name, which must stay in `roles` or be
renamed as above. Owner protection and ownership transfer stop applying.

## Rename a permission key

Keys are not stored, so this is a code change. Every client reading the
[payload](client.md) must change in the same deployment.

## Upgrading the package

Patch releases never break. While the package is on `0.x`, a minor release may break only with a
`### Changed` entry marked **Breaking** and an `### Upgrading` section in the changelog. Released
migration stubs never change; a schema change ships as a new stub that `configure` publishes on a
re-run. Account Kit is an exact peer, so adopting a new kit release is a package release.
