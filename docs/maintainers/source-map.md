# Maintainer source map

Start with the owning module and its focused test. Read the relevant
[specification](design/spec-access-control.md) section when changing behaviour.

## Public entry points and reference coverage

The `exports` map in [package.json](../../package.json) defines supported imports. Generated API
routes below are relative to the documentation site's base. Run `pnpm docs:api` to regenerate
their Markdown sources under `docs/reference/api/`.

| Public subpath              | Source                                 | Reference coverage                                      |
| --------------------------- | -------------------------------------- | ------------------------------------------------------- |
| package root                | `index.ts`                             | `reference/api/index/index`                             |
| `./types`                   | `src/types.ts`                         | `reference/api/src/types/index`                         |
| `./access_control_provider` | `providers/access_control_provider.ts` | `reference/api/providers/access_control_provider/index` |
| `./services/main`           | `services/main.ts`                     | `reference/api/services/main/index`                     |
| `./middleware`              | `middleware/main.ts`                   | `reference/api/middleware/main/index`                   |
| `./account-kit`             | `account_kit/main.ts`                  | `reference/api/account_kit/main/index`                  |
| `./commands`                | `commands/main.ts`                     | `reference/api/commands/main/index`                     |

TypeDoc requires comments on classes, functions, interfaces, type aliases and variables. Comments
should explain a contract, ordering or non-obvious constraint.

## Modules by task

| Task                            | Module                                                                                                  | Focused tests                                                                                   | Specification      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------ |
| Configure the package in an app | `configure.ts`, `stubs/`                                                                                | `tests/configure.spec.ts` (M5)                                                                  | 11                 |
| Validate the configuration      | `src/define.ts`                                                                                         | `tests/define.spec.ts`, `tests/types/define.ts`                                                 | 2                  |
| Pure rules and truth tables     | `src/rules.ts`                                                                                          | `tests/rules.spec.ts`                                                                           | 3                  |
| Memberships table               | `stubs/migrations/access_control_create_memberships.stub`, `stubs/migrations/released.json`, `src/migration_schema.ts` | `tests/migration_stubs.spec.ts`, `tests/helpers/schema.ts`                                      | 4.1, 17.1          |
| Lock process and transactions   | `src/locks.ts`, `src/kit_transaction.ts`, `src/keys.ts`                                                 | `tests/locks.spec.ts`, `tests/kit_transaction.spec.ts`, `tests/memberships_concurrency.spec.ts` | 0.2, 4.2, 4.3, 5.1 |
| Membership service              | `src/memberships.ts`, `src/pagination.ts`                                                               | `tests/memberships.spec.ts`, `tests/memberships_trusted.spec.ts`, `tests/pagination.spec.ts`    | 5                  |
| Errors and responses            | `src/errors.ts`                                                                                         | `tests/errors.spec.ts`                                                                          | 6                  |
| Scope middleware                | `middleware/main.ts` (M3)                                                                               | `tests/middleware.spec.ts` (M3)                                                                 | 7                  |
| Bouncer abilities               | `src/abilities.ts` (M3)                                                                                 | `tests/abilities.spec.ts` (M3)                                                                  | 8                  |
| Account Kit callbacks           | `account_kit/main.ts` (M4)                                                                              | `tests/account_kit.spec.ts` (M4)                                                                | 9                  |
| Client payload                  | `src/payload.ts` (M3)                                                                                   | `tests/payload.spec.ts` (M3)                                                                    | 10                 |
| Doctor command                  | `commands/` (M5)                                                                                        | `tests/doctor.spec.ts` (M5)                                                                     | 17.2               |
| Package exports and docs links  | `index.ts`, `docs/`                                                                                     | `tests/package_exports.spec.ts`, `tests/docs_links.spec.ts`                                     | 1.5                |
| Check scripts                   | `bin/`                                                                                                  | `tests/tooling/` (as added)                                                                     | 1.5                |

Rows marked with a milestone name the module and test that milestone adds; until then the row is
a plan, not a map.
