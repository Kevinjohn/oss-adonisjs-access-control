# Decisions

## Departures

1. **Aligning** — PKG-7. First-party `@kevinjohn/*` peers are pinned to the exact supported release until launch, because the packages depend on one specific Account Kit version. Third-party peers use caret ranges. Brought into line by #184.

2. **Aligning (#190)** — PKG-1. The strict repository contract in `AGENTS.md` and build specification sections 1.6–1.7 prescribes the exported `account_kit/` and `middleware/` entry points. The package export map and build entries implement that contract. Retain these two folders until [#190](https://github.com/Kevinjohn/oss-adonisjs-access-control/issues/190) reconciles the shared layout rule and the repository contract while preserving public subpaths and consumer validation.

3. DB-6 — The Account Kit migration `examples/consumer/database/migrations/1793881607467_account_kit_add_account_columns_to_users.ts` has no `protected tableName`. It is a historical generated fixture, introduced in `37ebc8d` and unchanged in the released `v0.4.1` tree (SHA-256 `a5cba427dc823fd6c92bd8e19e0db5380857d78c47071b5d727454cd7e51d9b4`). Preserve its body under the repository's migration immutability rule and DB-7. Adding an unused field cannot change that migration's behavior; future migrations follow DB-6. This departure covers only that file.
