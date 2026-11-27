# US-ACCESS-08 — Transfer scope ownership

As an active scope owner, I want to transfer scope ownership so that a scope continues to have a clearly assigned owner.

**Status:** Current when an owner role is configured
**Access:** Only active owner can transfer to a different active member; actor's owner role and target membership status are checked under locks.
**Entry:** Owner route calls `memberships.transferOwnership({ actor, scopeId, toUserId, trx? })`.
**Documentation:** [memberships.md](../docs/guide/memberships.md)
**Source:** [src/memberships.ts](../src/memberships.ts)
**Coverage:** [`tests/memberships.spec.ts`](../tests/memberships.spec.ts)

## Acceptance criteria

- Transfer is unavailable if no owner role is configured.
- Actor must be the active owner; target must be a different active member. A scope row that does not exist is refused with `E_ACCESS_CONTROL_SCOPE_NOT_FOUND` (404) when the scope is locked, before the actor is checked.
- The target becomes owner and prior owner is demoted to highest non-owner role in same transaction; the optional change callback receives the transfer.

## User flow

```mermaid
flowchart TD
    A["Owner selects an active member as next owner"] --> B{"Owner and target eligible?"}
    B -->|No| C["See transfer refusal"]
    B -->|Yes| D["Ownership changes and former owner is demoted"]
```

## Code flow

Scope: package behaviour; the runner commits when `input.trx` is omitted; supplied transactions remain caller-owned and may later roll back; the host owns team records, page rendering, route placement, record-level policy, and trusted operations outside the package callback.

```mermaid
flowchart TD
    A["MembershipService.transferOwnership"] --> O{"Owner role configured?"}
    O -->|No| E["throw domain error"]
    O -->|Yes| B["transaction locks actor/target users and scope"]
    B --> C["require active owner, then distinct target ID, then existing active target"]
    C --> D{"Checks pass?"}
    D -->|No| E["throw domain error"]
    D -->|Yes| F["demote prior owner, promote target, invoke optional onMembershipChanged with membership.ownership_transferred"]
    F --> G["runner commits if trx omitted; otherwise caller owns commit"]
```

**Code references:** [transferOwnership](../src/memberships.ts), [lock order](../src/locks.ts)
