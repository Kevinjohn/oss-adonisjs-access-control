# Setup

Access Control needs an AdonisJS 7 application that already runs Account Kit, a users table and
a table for the scope your members belong to (teams, organisations, workspaces). Install the
release tarball, then let `configure` write the files.

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-access-control/releases/download/v0.1.0/kevinjohn-adonisjs-access-control-0.1.0.tgz
node ace configure @kevinjohn/adonisjs-access-control --scope-table=teams
node ace migration:run
```

## What configure does

| Step | Result                                                                                       |
| ---- | -------------------------------------------------------------------------------------------- |
| 1    | Stops with a message when `config/account_kit.ts` is missing or `--scope-table` is absent.   |
| 2    | Writes `config/access_control.ts` with the example roles and the table names from the flags. |
| 3    | Publishes `database/migrations/<timestamp>_create_memberships.ts`.                           |
| 4    | Registers the provider and the `access-control:doctor` command in `adonisrc.ts`.             |
| 5    | Registers the named middleware `scope` in `start/kernel.ts`.                                 |
| 6    | Prints the Bouncer initializer and Account Kit config changes for you to apply.              |

Existing files are skipped with a message, never rewritten. Re-running after a package upgrade
publishes only migrations that are new to the application.

Flags:

| Flag                  | Default       | Values                      |
| --------------------- | ------------- | --------------------------- |
| `--scope-table`       | required      | a plain SQL identifier      |
| `--scope-id-type`     | `integer`     | `integer`, `string`, `uuid` |
| `--users-table`       | `users`       | a plain SQL identifier      |
| `--user-id-type`      | `integer`     | `integer`, `string`, `uuid` |
| `--memberships-table` | `memberships` | a plain SQL identifier      |

The key types must match the primary keys of the users and scope tables: `integer` for
`increments()` columns, `uuid` for `uuid()` columns and `string` for string keys up to 254
characters.

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

## Not supported after install

Changing `membershipsTable`, `users.table`, `scope.table` or any key type once the migration has
run is not supported. Treat it as a new install: configure with the new values, migrate, and copy
the rows with your own migration.

## Testing your application

The package writes through Account Kit's transaction runner. In a test database create the kit's
`account_transaction_lock` row and the users and scope tables before the memberships migration;
every service method accepts a caller `trx` started by the kit's `transaction()` so a test can roll
everything back.
