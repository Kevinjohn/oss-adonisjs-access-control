# US-ACCESS-22 — Diagnose the Access Control installation

As an application operator, I want to diagnose the access control installation so that the operator can find schema or configuration mismatches before traffic depends on them.

**Status:** Operator
**Access:** Operator runs diagnostic command against configured database/schema.
**Entry:** Run `node ace access-control:doctor [--scope=<id>] [--json]` after migration and required setup.
**Documentation:** [setup.md](../docs/guide/setup.md)
**Source:** [AccessControlDoctor](../commands/doctor.ts), [runDoctor](../src/doctor.ts)
**Coverage:** [`tests/doctor.spec.ts`](../tests/doctor.spec.ts)

## Acceptance criteria

- With no flags, the command checks all scopes and prints named results, counts and up to 20 sample IDs. Optional `--scope=<id>` restricts row checks to one normalized configured scope; `--json` prints the report as JSON.
- `runDoctor` checks that the configured memberships table and required columns exist, then checks exact known role/status strings and orphan user/scope references.
- When an owner role is configured, scopes represented by membership rows are checked for zero or multiple active owners. Scopes without any membership rows are outside that row grouping.
- The command supplies installed/expected Account Kit versions for a compatibility check. Direct `runDoctor` calls may omit that optional check.
- Exit code is 0 when checks are clean, 1 when checks find inconsistencies, and 2 when a check cannot run. The operation neither writes nor locks rows.
- It does not validate database column types or indexes, replace operational checks, or repair data; copy the published migration body and correct reported issues before cutover.

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
    B --> C["runDoctor({ access, db, scope, accountKit: accountKitVersions() })"]
    C --> D["Check table and required columns"]
    D --> E["If schema permits, check roles, statuses, owners and orphans"]
    E --> F["Append optional Account Kit version check"]
    F --> G["Render JSON or named counts/sample IDs"]
    G --> H["Set exit 0 or 1; caught inability to run sets exit 2"]
```

**Code references:** [AccessControlDoctor flags and run](../commands/doctor.ts), [runDoctor and accountKitVersions](../src/doctor.ts), [setup guide](../docs/guide/setup.md), [adoption limits](../docs/guide/adopting.md).
