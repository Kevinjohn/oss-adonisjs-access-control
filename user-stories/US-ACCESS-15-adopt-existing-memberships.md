# US-ACCESS-15 — Adopt existing membership data

As an application operator, I want to adopt existing membership data so that access data is reconciled before the application changes over.

**Status:** Operator
**Access:** Migration owner has access to application membership table and follows the documented staged adoption procedure.
**Entry:** Follow adoption guide to map, copy and reconcile existing membership rows before switching services.
**Documentation:** [adopting.md](../docs/guide/adopting.md)
**Source:** [configure](../configure.ts), [published schema](../src/migration_schema.ts), [doctor command](../commands/doctor.ts), [runDoctor](../src/doctor.ts)
**Coverage:** [`tests/migration_stubs.spec.ts`](../tests/migration_stubs.spec.ts)

## Acceptance criteria

- Existing table shape and key types are compared with configured membership schema before cutover.
- The application moves data and validates counts/keys/roles before switching reads and writes to package service.
- The package does not silently infer or migrate arbitrary app-owned team/domain rules.

## User flow

```mermaid
flowchart TD
    A["Operator inventories existing membership table"] --> B["Map columns and key types to package schema"]
    B --> C{"Rows and roles reconcile?"}
    C -->|No| D["Correct data mapping before cutover"]
    C -->|Yes| E["Switch app operations to package service"]
```

## Code flow

Scope: package configuration/schema publication and doctor diagnostics surround a host-written data migration. The package never reads the old membership table.

```mermaid
flowchart TD
    A["configureWith publishes a separate membership-table migration"] --> B["Host writes a later application migration mapping existing rows"]
    B --> C["Host runs node ace migration:run"]
    C --> D["AccessControlDoctor.run invokes runDoctor"]
    D --> E{"Copied rows and configured schema checks clean?"}
    E -->|No| F["Host corrects migration/data before cutover"]
    E -->|Yes| G["Host routes through scope/abilities and stops old-table writes"]
```

**Code references:** [Adoption instructions and host migration example](../docs/guide/adopting.md), [configureWith](../configure.ts), [published schema](../src/migration_schema.ts), [AccessControlDoctor](../commands/doctor.ts), [runDoctor](../src/doctor.ts).
