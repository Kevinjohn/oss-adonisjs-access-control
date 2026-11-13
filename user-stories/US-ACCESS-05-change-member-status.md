# US-ACCESS-05 — Suspend or reactivate a member

As an active scope manager, I want to suspend or reactivate a member so that scoped access can be suspended or restored deliberately.

**Status:** Current
**Access:** Actor must pass `members:manage`; cannot manage self, owner, or higher-ranked target.
**Entry:** Host member route calls `memberships.setStatus(...)`.
**Documentation:** [memberships.md](../docs/guide/memberships.md)
**Source:** [src/memberships.ts](../src/memberships.ts)
**Coverage:** [`tests/memberships.spec.ts`](../tests/memberships.spec.ts)

## Acceptance criteria

- Supported statuses are `active` and `suspended`.
- Self, owner, unknown-role and rank restrictions refuse the change.
- A no-op status update emits no event; a change emits `membership.status_changed`. Suspended users are denied by scope middleware.

## User flow

```mermaid
flowchart TD
    A["Manager suspends or reactivates member"] --> B{"Actor may manage target?"}
    B -->|No| C["See authorization error"]
    B -->|Yes| D["Status changes"]
    D --> E{"New status suspended?"}
    E -->|Yes| F["Next scoped request is refused"]
    E -->|No| G["Active membership may enter scoped route"]
```

## Code flow

Scope: package behavior; the host owns team records, page rendering, route placement, record-level policy, and trusted operations outside the package callback.

```mermaid
flowchart TD
    A["MembershipService.setStatus"] --> B["validate status; transaction and locks"]
    B --> C["require active actor and apply canManage"]
    C --> D{"Allowed?"}
    D -->|No| E["throw rule error"]
    D -->|Yes| F["update when changed and emit status_changed"]
    F --> G["ScopeMiddleware later accepts active status only"]
```

**Code references:** [setStatus](../src/memberships.ts), [scope middleware](../middleware/main.ts)
