# Decisions

## Departures

1. **Aligning** — PKG-7. First-party `@kevinjohn/*` peers are pinned to the exact supported release until launch, because the packages depend on one specific Account Kit version. Third-party peers use caret ranges. Brought into line by #184.

2. **Aligning (Kevinjohn/oss-adonisjs-code-conventions#23)** — IMP-5. The checker reads import examples inside strings as package imports. `configure.ts` prints an application's `#config/access_control` import; `tests/configure.spec.ts` builds and asserts an application's `#middleware/auth_middleware` import. Neither imports application code into the package, which declares no aliases. Preserve these application imports (IMP-4) until the checker distinguishes syntax from string content. [Issue and acceptance criteria](https://github.com/Kevinjohn/oss-adonisjs-code-conventions/issues/23). Coverage is limited to those two files.

3. **Aligning (#190)** — PKG-1. The strict repository contract in `AGENTS.md` and build specification sections 1.6–1.7 prescribes the exported `account_kit/` and `middleware/` entry points, documentation tooling under `docs/`, and consumer fixtures under `examples/`. The package export map and build entries implement that contract; documentation and consumer source are not shipped runtime implementation. Retain these four folders until [#190](https://github.com/Kevinjohn/oss-adonisjs-access-control/issues/190) reconciles the shared layout rule and the repository contract while preserving public subpaths and consumer validation.

4. DB-6 — The Account Kit migration `examples/consumer/database/migrations/1793881607467_account_kit_add_account_columns_to_users.ts` has no `protected tableName`. It is a historical generated fixture, introduced in `37ebc8d` and unchanged in the released `v0.4.1` tree (SHA-256 `a5cba427dc823fd6c92bd8e19e0db5380857d78c47071b5d727454cd7e51d9b4`). Preserve its body under the repository's migration immutability rule and DB-7. Adding an unused field cannot change that migration's behavior; future migrations follow DB-6. This departure covers only that file.
