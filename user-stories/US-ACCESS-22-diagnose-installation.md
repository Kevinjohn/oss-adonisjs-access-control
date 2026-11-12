# US-ACCESS-22 — Diagnose the Access Control installation

As an application operator, I want to diagnose the access control installation so that the operator can find schema or configuration mismatches before traffic depends on them.

**Status:** Operator
**Access:** Operator runs diagnostic command against configured database/schema.
**Entry:** Run `node ace access-control:doctor` after migration and required setup.
**Documentation:** [setup.md](../docs/guide/setup.md)
**Source:** [src/doctor.ts](../src/doctor.ts)
**Coverage:** [`tests/doctor.spec.ts`](../tests/doctor.spec.ts)

## Acceptance criteria

- Doctor checks configured memberships table and required schema against config and reports whether setup is consistent.
- It does not validate every database index/type or replace operational checks; adoption guide says it checks table and columns, not types/indexes.

## User flow

```mermaid
flowchart TD
    A["Operator runs access-control:doctor"] --> B{"Schema and config consistent?"}
    B -->|No| C["Read diagnostics and correct migration/config"]
    B -->|Yes| D["Installation check exits successfully"]
```

## Code flow

Scope: package behavior and host callback boundary; the application owns its screens, scope records and transaction commit.

```mermaid
flowchart TD
    A["Doctor command invokes source inspector"] --> B["read AccessControl config and memberships schema"]
    B --> C{"Required table/columns present?"}
    C -->|No| D["report diagnostics and nonzero exit"]
    C -->|Yes| E["report consistent setup"]
```

**Code references:** [doctor](../src/doctor.ts), [setup guide](../docs/guide/setup.md), [adoption limits](../docs/guide/adopting.md)
