# US-ACCESS-14 — Configure Access Control

As an application operator, I want to configure Access Control so that the application can use the package with its actual scope schema.

**Status:** Operator
**Access:** Operator configures roles, schema and provider after Account Kit is installed.
**Entry:** After Account Kit has created `config/account_kit.ts`, run `node ace configure @kevinjohn/adonisjs-access-control --scope-table=<table>`.
**Documentation:** [setup.md](../docs/guide/setup.md)
**Source:** [configure.ts](../configure.ts)
**Coverage:** [`tests/configure.spec.ts`](../tests/configure.spec.ts)

## Acceptance criteria

- In an interactive terminal, omitting `--scope-table` prompts for the table. Unattended runs must supply it. Optional flags are `--scope-id-type` (`integer`, default), `--users-table` (`users`), `--user-id-type` (`integer`) and `--memberships-table` (`memberships`). Key types are `integer`, `string` or `uuid`; table names must be plain SQL identifiers.
- Configure refuses when Account Kit config is missing. Invalid flag values and unsafe migration histories fail before codemods write files. `--migration-path` selects the destination, defaulting to the app migrations path. New migrations follow existing parent migrations in filename order. A rerun preserves existing files and publishes only missing released successors. A missing predecessor with an installed successor requires operator reconciliation.
- Configure writes config and released migration(s), registers provider, doctor command and named `scope` middleware, and prints the Bouncer and Account Kit edits for the operator to apply. Run migrations after applying those changes.

## User flow

```mermaid
flowchart TD
    A["Operator installs Account Kit and chooses a scope table"] --> B["Run Access Control configure with flag or interactive answer"]
    B --> C{"Account Kit config and valid scope table available?"}
    C -->|No| D["Configure reports setup error"]
    C -->|Yes| E["Apply printed Bouncer and callback steps; run migrations"]
```

## Code flow

Scope: configure publishes package files and integration steps; the operator applies the host-owned code printed by the command.

```mermaid
flowchart TD
    A["configure(command)"] --> B["require Account Kit config and resolve table from flag or prompt"]
    B --> C{"Prerequisites present?"}
    C -->|No| D["log error and set exit code"]
    C -->|Yes| E["write config and released migrations if absent"]
    E --> F["register provider, command and named scope middleware"]
    F --> G["print manual Bouncer and Account Kit integration steps"]
```

**Code references:** [configure](../configure.ts), [setup guide](../docs/guide/setup.md)
