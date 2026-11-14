# US-ACCESS-26 — Audit or react to membership changes

As an application integrator, I want to audit or react to membership changes so that my own records or notifications follow every membership write.

**Status:** Current when `onMembershipChanged` is set in the configuration
**Access:** Application config author supplies the hook; the package calls it for every membership write, whoever the actor.
**Entry:** `onMembershipChanged` property of the object passed to `defineAccessControl`.
**Documentation:** [memberships.md](../docs/guide/memberships.md#events)
**Source:** [hook type](../src/types.ts), [emit](../src/memberships.ts)
**Coverage:** [`tests/memberships.spec.ts`](../tests/memberships.spec.ts)

## Acceptance criteria

| Field   | Control                             | Required/default/conditions                                                                                                                                                                                         |
| ------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event` | Callback argument `MembershipEvent` | One of `membership.added`, `first_member`, `invitation_accepted`, `granted`, `role_changed`, `status_changed`, `removed` (reason `removed`, `scope_deleted` or `account_deleted`), `left`, `ownership_transferred`. |
| `trx`   | Callback argument                   | The transaction of the write: the caller's when one was supplied, otherwise the runner's own.                                                                                                                       |

- The hook is optional; without it writes emit nothing.
- It runs inside the write transaction after the row changes. Throwing rolls the write back.
- It must not lock or write other users' rows or Account Kit tables, which sit earlier in the lock order; writing application tables is allowed.
- A role or status update that changes nothing writes no row and emits no event.

## User flow

```mermaid
flowchart TD
    A["Developer sets onMembershipChanged in the configuration"] --> B["A membership write runs"]
    B --> C["Hook receives the event inside the write transaction"]
    C --> D{"Hook throws?"}
    D -->|Yes| E["Write is rolled back; caller sees the error"]
    D -->|No| F["Hook's own rows commit with the membership change"]
```

## Code flow

Scope: package emit point and the host-supplied hook; what the hook does with the event is host-owned.

```mermaid
flowchart TD
    A["MembershipService write method"] --> B["lock, validate and write the membership row"]
    B --> C["#emit(event, trx)"]
    C --> D["config.onMembershipChanged?.(event, trx)"]
    D --> E{"Hook throws?"}
    E -->|Yes| F["error propagates; transaction rolls back"]
    E -->|No| G["write returns; runner commits if trx was omitted"]
```

**Code references:** [Hook type](../src/types.ts), [emit](../src/memberships.ts), [events guide](../docs/guide/memberships.md#events)
