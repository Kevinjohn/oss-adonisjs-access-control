# US-ACCESS-25 — Remove memberships when deleting a scope

As an application operator, I want to remove memberships when deleting a scope so that scope deletion removes its memberships in the same host transaction and records each removal.

**Status:** Current when host scope deletion transaction calls the integration method
**Access:** Trusted application code; `removeAllForScope` requires caller transaction and does not authorize actor.
**Entry:** Before deleting the scope row, host calls `memberships.removeAllForScope({ scopeId, trx })` in same transaction.
**Documentation:** [memberships.md](../docs/guide/memberships.md)
**Source:** [src/memberships.ts](../src/memberships.ts)
**Coverage:** [`tests/memberships_trusted.spec.ts`](../tests/memberships_trusted.spec.ts)

## Acceptance criteria

- The method snapshots current member IDs, locks user rows then scope, and checks the set did not change.
- Concurrent membership-set change raises `E_ACCESS_CONTROL_CONFLICT`; host retries the whole deletion transaction.
- Membership rows and any `membership.removed` callback work with reason `scope_deleted` share the host transaction. Optional actor is recorded in callback records only, not authorized by this method.
- The method does not touch the scope's pending Account Kit invitations. Revoke them before deleting the scope or removing the memberships needed to authorize revocation ([US-ACCESS-24](US-ACCESS-24-revoke-invitation.md)). Otherwise, a matched invitation to a deleted scope makes the invitee's activation or confirming password reset fail on every retry ([US-ACCESS-10](US-ACCESS-10-accept-invitation.md)).

## User flow

```mermaid
flowchart TD
    A["Application plans scope deletion"] --> P["Revoke pending invitations while the scope and authorizing membership still exist"]
    P --> B["Remove scope memberships before deleting scope row"]
    B --> C{"Membership set remained stable?"}
    C -->|No| D["Retry deletion transaction"]
    C -->|Yes| E["Delete scope and commit together"]
```

## Code flow

Scope: package behaviour and host callback boundary; the application owns its screens, scope records and transaction commit.

```mermaid
flowchart TD
    A["MembershipService.removeAllForScope requires trx"] --> B["resolve stored keys; snapshot members; lock users then scope"]
    B --> C["read member set again"]
    C --> D{"Same member user IDs?"}
    D -->|No| E["throw CONFLICT"]
    D -->|Yes| F["delete memberships and invoke optional onMembershipChanged for each scope_deleted removal"]
    F --> G["host deletes scope row in same trx"]
```

**Code references:** [removeAllForScope](../src/memberships.ts), [lock order](../src/locks.ts)
