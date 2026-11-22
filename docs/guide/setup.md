# Setup

Access Control needs an AdonisJS 7 application that already runs Account Kit 0.5.0 (the release
with the `./transaction` export, scoped invitations and `ctx.auth.user` after its middleware), a
users table and a table for the scope your members belong to (teams, organisations, workspaces). Install the release tarball, then let `configure` write the
files.

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-access-control/releases/download/v0.3.0/kevinjohn-adonisjs-access-control-0.3.0.tgz
node ace configure @kevinjohn/adonisjs-access-control --scope-table=teams
node ace migration:run
```

Version 0.3.0 introduced the interactive prompt, custom host paths and safe migration ordering
described below.

## What configure does

| Step | Result                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | Checks for `account_kit.ts` in the host config directory; prompts for a missing scope table only in an interactive terminal. |
| 2    | Writes `access_control.ts` in the host config directory with the example roles and table names.                              |
| 3    | Publishes `<timestamp>_access_control_create_memberships.ts` in the selected migrations directory.                           |
| 4    | Registers the provider and the `access-control:doctor` command in `adonisrc.ts`.                                             |
| 5    | Registers the named middleware `scope` in `start/kernel.ts`.                                                                 |
| 6    | Prints the Bouncer initializer and Account Kit config changes for you to apply.                                              |

Existing files are skipped with a message, never rewritten. Re-running after a package upgrade
publishes only migrations that are new to the application. Run one configure process at a time
for an application. Sequential reruns are supported; concurrent configure processes are not
coordinated and can race while publishing migrations or editing application source.

Flags:

| Flag                  | Default                                  | Values                                                   |
| --------------------- | ---------------------------------------- | -------------------------------------------------------- |
| `--scope-table`       | prompt in a terminal; required otherwise | a plain SQL identifier                                   |
| `--scope-id-type`     | `integer`                                | `integer`, `string`, `uuid`                              |
| `--users-table`       | `users`                                  | a plain SQL identifier                                   |
| `--user-id-type`      | `integer`                                | `integer`, `string`, `uuid`                              |
| `--memberships-table` | `memberships`                            | a plain SQL identifier                                   |
| `--migration-path`    | host `app.migrationsPath()`              | the migration directory relative to the application root |

By default the destination follows the AdonisJS RC migrations directory. When Lucid configures
an explicit `migrations.paths` override for the intended connection, pass `--migration-path`
with the appropriate directory and keep that choice on reruns. Configure does not load the
application database or choose a connection for you. It places newly published migrations after
the greatest existing numeric prefix in that directory, including future-dated parent
migrations, in released dependency order. Existing files are never renamed. If an already
published successor has a missing predecessor or the package migration order cannot safely
be extended, configure stops before publishing and asks you to review that history. Do not
rename applied migrations. In multiple-directory configurations, Lucid runs sources in the
configured directory order; a later timestamp in one source cannot reorder another source.
Ensure the users and scope parent migrations run before the membership migration.

The key types must match the primary keys of the users and scope tables: `integer` for
`increments()` columns, `uuid` for `uuid()` columns and `string` for string keys up to 254
characters. For string keys, the parent table's stored spelling is used when a read or write
finds a matching parent under its collation. Choose a stable spelling for each key.
The memberships table name must be at most 45 ASCII characters so the released migration's
generated index names fit PostgreSQL's 63-byte identifier limit. Configure rejects longer names
before writing application files.

## Source registration prerequisites

Configure's provider, command and middleware edits use the framework's assembler transformer.
Run configure in a development installation with `@adonisjs/assembler` 8.6 or later in the
8.x line available and check its
warnings. If the framework skips a source edit, the printed next steps do not mean registration
succeeded. Repair the development installation and rerun configure, or register these entries
manually alongside the application's existing entries:

- In `adonisrc.ts`, add `() => import('@kevinjohn/adonisjs-access-control/access_control_provider')`
  to `providers`, after Lucid and Account Kit.
- In `adonisrc.ts`, add `() => import('@kevinjohn/adonisjs-access-control/commands')` to `commands`.
- In `start/kernel.ts`, add `scope: () => import('@kevinjohn/adonisjs-access-control/middleware')`
  to the object passed to `router.named()`.

Then complete the Bouncer and Account Kit steps below and verify the scoped route as shown in
[getting started](getting-started.md).

Assembler is an optional development peer for configure's source transforms, not a requirement
for a deployed application that already has the generated sources.

## The two manual steps

Bouncer abilities are generated from your permission keys and merged into the request's Bouncer
in `app/middleware/initialize_bouncer_middleware.ts`; see the [Bouncer guide](bouncer.md). Account
Kit learns about team invitations, account deletion and data export through callbacks passed in
`config/account_kit.ts`; see the [Account Kit guide](account-kit.md).

## Check the installation

```sh
node ace access-control:doctor
```

The doctor reads the memberships table against the configuration and exits 0 when everything is
consistent. The [changing roles guide](changing-roles.md) lists its checks.

The command starts the application, so its installed peers (including Account Kit), providers
and configuration must load first. If boot fails because a peer is missing or cannot be loaded,
repair the installation with `pnpm install` and verify the configured versions before running
the doctor again. Its version check is not a pre-boot dependency recovery command.

## Not supported after install

Changing `membershipsTable`, `users.table`, `scope.table` or any key type once the migration has
run is not an automatic configure operation. In a separate fresh application, configure the new
values and migrate before copying data with an application-owned migration.

In an existing application, rerunning configure with different flags preserves the existing
configuration and skips already-published migration suffixes; it does not convert the schema.
Plan an application-owned migration and data copy, update the configuration explicitly, and
verify foreign keys, key representations and all consumers before cutover. Back up the data
and plan rollback before running it. Keep released package migration stubs unchanged. An
application that already stores memberships in its own table follows the
[adoption guide](adopting.md).

## Testing your application

The package writes through Account Kit's transaction runner. In a test database create the kit's
`account_transaction_lock` row and the users and scope tables before the memberships migration;
every service method accepts a caller `trx` started by the kit's `transaction()` so a test can roll
everything back.
