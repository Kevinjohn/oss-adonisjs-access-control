# US-ACCESS-26 — Audit or react to membership changes

As an application integrator, I want to audit or react to membership changes so that my own records or notifications follow every membership write.

**Status:** Current when `onMembershipChanged` is set in the configuration
**Access:** Application config author supplies the hook; the package calls it for every membership write, whoever the actor.
**Entry:** `onMembershipChanged` property of the object passed to `defineAccessControl`.
**Documentation:** [memberships.md](../docs/guide/memberships.md#events)
**Source:** [hook type](../src/types.ts), [emit](../src/memberships.ts)
**Coverage:** [`tests/memberships.spec.ts`](../tests/memberships.spec.ts)

## Acceptance criteria

| Field   | Control                             | Required/default/conditions                                                                                                                                                                                                                                                                                                 |
| ------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event` | Callback argument `MembershipEvent` | `event.type` is one of `membership.added`, `membership.first_member`, `membership.invitation_accepted`, `membership.granted`, `membership.role_changed`, `membership.status_changed`, `membership.removed` (reason `removed`, `scope_deleted` or `account_deleted`), `membership.left`, `membership.ownership_transferred`. |
| `trx`   | Callback argument                   | The transaction of the write: the caller's when one was supplied, otherwise the runner's own.                                                                                                                                                                                                                               |

- The hook is optional; without it writes emit nothing.
- It runs inside the write transaction after the row changes. A throw propagates out of the write method. When `trx` was omitted, the runner rolls the write back; when the caller supplied `trx`, the caller must let the error escape or roll back, because catching it and committing keeps the membership write.
- It must not lock or write other users' rows or Account Kit tables, which sit earlier in the lock order; writing application tables is allowed.
- A role or status update that changes nothing writes no row and emits no event.

## User flow

```mermaid
flowchart TD
    A["Developer sets onMembershipChanged in the configuration"] --> B["A membership write runs"]
    B --> C["Hook receives the event inside the write transaction"]
    C --> D{"Hook throws?"}
    D -->|Yes| E["Caller sees the error; write rolls back unless a caller-owned transaction is committed anyway"]
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
    E -->|Yes| F["error propagates; runner rolls back if trx was omitted, otherwise the caller owns rollback"]
    E -->|No| G["write returns; runner commits if trx was omitted"]
```

**Code references:** [Hook type](../src/types.ts), [emit](../src/memberships.ts), [events guide](../docs/guide/memberships.md#events)
