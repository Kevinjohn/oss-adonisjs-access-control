# US-ACCESS-22 — Diagnose the Access Control installation

As an application operator, I want to diagnose the access control installation so that the operator can find schema or configuration mismatches before traffic depends on them.

**Status:** Operator
**Access:** Operator runs diagnostic command against configured database/schema.
**Entry:** Run `node ace access-control:doctor [--scope=<id>] [--json]` after migration and required setup.
**Documentation:** [setup.md](../docs/guide/setup.md)
**Source:** [AccessControlDoctor](../commands/doctor.ts), [runDoctor](../src/doctor.ts)
**Coverage:** [`tests/doctor.spec.ts`](../tests/doctor.spec.ts)

## Acceptance criteria

- Owner diagnostics count all matching scope groups and return up to 20 ordered scope IDs for each finding. A report count can exceed its sample length. Role and status comparisons use exact case even on MySQL.

- With no flags, the command checks all scopes and prints named results, counts and up to 20 sample IDs. Optional `--scope=<id>` restricts row checks to one normalized configured scope; `--json` prints the report as JSON.
- `runDoctor` checks that the configured memberships table and required columns exist. If present, it checks the unconditional unique scope/user pair and both restrictive parent foreign keys across the entire table, then reports null or unrecognized roles and statuses, null or unreadable timestamps, and orphan user/scope references. A row contributes once to `invalid_timestamp` if either timestamp cannot be read.
- When an owner role is configured, scopes represented by membership rows are checked for zero or multiple active owners. Scopes without any membership rows are outside that row grouping.
- The command supplies installed/expected Account Kit versions for a compatibility check. A missing or mismatched version is a finding. An unreadable manifest or missing version field in an installed manifest prevents the check from running.
- Exit code is 0 when checks are clean, 1 when checks find inconsistencies, and 2 when a check cannot run. The operation neither writes nor locks rows.
- Apart from the specific unique-pair and foreign-key checks, it does not validate database column types or all indexes, replace operational checks, or repair data; copy the published migration body and correct reported issues before cutover.

## User flow

```mermaid
flowchart TD
    A["Operator runs doctor with optional scope or JSON output"] --> B{"Checks can run?"}
    B -->|No| C["Read error; command exits 2"]
    B -->|Yes| D{"Any schema, membership, owner or version inconsistency?"}
    D -->|Yes| E["Read report and correct issue; command exits 1"]
    D -->|No| F["Read clean report; command exits 0"]
```

## Code flow

Scope: read-only Ace command through package diagnostics and report presentation.

```mermaid
flowchart TD
    A["AccessControlDoctor.run"] --> B["Resolve AccessControl and lucid.db"]
    B --> C["Read installed and expected Account Kit versions"]
    C -->|Version lookup throws| X["Report inability to run and exit 2"]
    C -->|Lookup completes| R["runDoctor checks schema and rows"]
    R --> D["Check table and required columns"]
    R -->|Check throws| X
    D -->|Missing table or column| F["Append optional Account Kit version check"]
    D -->|Present| I["Inspect unique pair and restrictive parent foreign keys"]
    I --> E["Resolve optional scope; check roles and statuses, scan timestamps, check owners and orphans"]
    E --> F
    F --> G["Render JSON or named counts/sample IDs"]
    G --> H["Set exit 0 if clean or 1 if findings"]
```

**Code references:** [AccessControlDoctor flags and run](../commands/doctor.ts), [runDoctor and accountKitVersions](../src/doctor.ts), [setup guide](../docs/guide/setup.md), [adoption limits](../docs/guide/adopting.md).
