# US-ACCESS-15 — Adopt existing membership data

As an application operator, I want to adopt existing membership data so that access data is reconciled before the application changes over.

**Status:** Operator
**Access:** Migration owner has access to application membership table and follows the documented staged adoption procedure.
**Entry:** Follow adoption guide to map, copy and reconcile existing membership rows before switching services.
**Documentation:** [adopting.md](../docs/guide/adopting.md)
**Source:** [src/migration_schema.ts](../src/migration_schema.ts)
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

Scope: package behavior; the host owns team records, page rendering, route placement, record-level policy, and trusted operations outside the package callback.

```mermaid
flowchart TD
    A["Adoption procedure reads existing table contract"] --> B["migration/schema inspection checks identifiers and key types"]
    B --> C["operator copies and reconciles data"]
    C --> D{"validated?"}
    D -->|No| E["do not cut over"]
    D -->|Yes| F["host switches reads/writes to MembershipService"]
```

**Code references:** [adoption guide](../docs/guide/adopting.md), [schema contract](../src/migration_schema.ts)
