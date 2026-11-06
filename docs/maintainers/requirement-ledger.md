# Requirement ledger

Maps each requirement in the [build specification](design/spec-access-control.md) to its test
file and case. Status columns are separate: **implemented** (code exists on `main` or in the
open milestone pull request), **verified** (the named test passed in the named command on the
named database) and **shipped** (part of a published release). A test name is not a pass
result; the verification column records the command and database outcome.

Legend: `-` not started; `M<n>` the milestone that delivers it.

## Scaffold (section 1)

| Requirement                                       | Evidence                                                                                                              | Implemented | Verified                                                             | Shipped |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------- | ------- |
| 1.5 built exports cover every subpath in 1.7      | `tests/package_exports.spec.ts` · "loads every built public export", "refuses deep imports of implementation modules" | M0          | `pnpm test:built-exports` (SQLite host)                              | -       |
| 1.5 docs links and anchors                        | `tests/docs_links.spec.ts` · all five cases                                                                           | M0          | `pnpm quick:test` (SQLite); CI runs it on PostgreSQL and MySQL cells | -       |
| 1.5 `pnpm check` and `pnpm check --full` profiles | `bin/check_profiles.ts`                                                                                               | M0          | `pnpm check --full`                                                  | -       |
| 1.8 CI on SQLite, PostgreSQL and MySQL            | `.github/workflows/checks.yml` matrix                                                                                 | M0          | first pull request run                                               | -       |
| 1.9 spec moved to `docs/maintainers/design/`      | this tree                                                                                                             | M0          | `tests/docs_links.spec.ts`                                           | -       |

## Configuration and rules (sections 2, 3)

| Requirement                                                                                             | Evidence                                                                                                                                                           | Implemented | Verified                                          | Shipped |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------- | ------- |
| 2.3 boot validation, each failure (1-6), frozen instance                                                | `tests/define.spec.ts` · "2.3.1 rejects empty roles" … "2.3.6 rejects a key type outside integer, string and uuid", "returns a frozen instance for a valid config" | M1          | `pnpm quick:test` on SQLite, PostgreSQL and MySQL | -       |
| 2.2 compile-time role and key inference                                                                 | `tests/types/define.ts` (`@ts-expect-error` cases compiled by `pnpm typecheck`)                                                                                    | M1          | `pnpm typecheck`                                  | -       |
| 3 `rank`, `can` per key per role, `permissionsFor`, `assignableRoles` with and without an owner role    | `tests/rules.spec.ts` · groups "rules: rank, can and permissionsFor", "rules: assignableRoles"                                                                     | M1          | `pnpm quick:test`                                 | -       |
| 3.1 every `canManage` row, first-match order                                                            | `tests/rules.spec.ts` · group "rules: canManage truth table", one case per row                                                                                     | M1          | `pnpm quick:test`                                 | -       |
| 3.2 every `canAssign` row, `canManage` first                                                            | `tests/rules.spec.ts` · group "rules: canAssign"                                                                                                                   | M1          | `pnpm quick:test`                                 | -       |
| 3.4 identity predicate: empty target, self, missing actor scope, suspended target scope, admin on owner | `tests/rules.spec.ts` · group "rules: canAdministerIdentity"                                                                                                       | M1          | `pnpm quick:test`                                 | -       |

## Database and membership service (sections 4, 5, 6, 17.1)

| Requirement                                                       | Evidence | Implemented | Verified | Shipped |
| ----------------------------------------------------------------- | -------- | ----------- | -------- | ------- |
| 4.1 migration stub, unique `(scope_id, user_id)`, `RESTRICT` keys | -        | M2          | -        | -       |
| 4.2 lock process and concurrency cases                            | -        | M2          | -        | -       |
| 5 service methods, events and errors                              | -        | M2          | -        | -       |
| 6 error codes and response shape                                  | -        | M2          | -        | -       |
| 17.1 released stub hashes                                         | -        | M2          | -        | -       |

## Middleware, Bouncer and payload (sections 7, 8, 10)

| Requirement         | Evidence | Implemented | Verified | Shipped |
| ------------------- | -------- | ----------- | -------- | ------- |
| 7 scope middleware  | -        | M3          | -        | -       |
| 8 Bouncer abilities | -        | M3          | -        | -       |
| 10 client payload   | -        | M3          | -        | -       |

## Account Kit callbacks (section 9)

| Requirement                                          | Evidence | Implemented | Verified | Shipped |
| ---------------------------------------------------- | -------- | ----------- | -------- | ------- |
| 9 invite, manage, list, acceptance, deletion, export | -        | M4          | -        | -       |

## Configure, doctor and docs (sections 11, 14, 17.2)

| Requirement                       | Evidence | Implemented | Verified | Shipped |
| --------------------------------- | -------- | ----------- | -------- | ------- |
| 11 configure on a fresh app       | -        | M5          | -        | -       |
| 17.2 doctor checks and exit codes | -        | M5          | -        | -       |
| 14 guides                         | -        | M5          | -        | -       |
