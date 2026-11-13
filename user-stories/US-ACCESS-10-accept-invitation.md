# US-ACCESS-10 — Accept a scoped invitation

As an invited account holder, I want to accept a scoped invitation so that acceptance creates the access promised by the invitation.

**Status:** Current when Account Kit acceptance callback is wired
**Access:** Invitation token/recipient validation is owned by Account Kit; scoped membership is created only for a canonical configured scope.
**Entry:** Account Kit accepts invitation then calls `onInvitationAccepted` callback.
**Documentation:** [account-kit.md](../docs/guide/account-kit.md)
**Source:** [account_kit/main.ts](../account_kit/main.ts)
**Coverage:** [`tests/account_kit.spec.ts`](../tests/account_kit.spec.ts)

## Acceptance criteria

- For a scoped invitation, scope must use canonical configured key spelling; invalid scope is refused.
- For scoped invitations, trusted `acceptInvitation` refuses unknown/owner roles and existing membership, otherwise creates membership inside the Account Kit transaction. The optional host callback runs for both scoped and global invitations in that transaction.
- Global invitation (`scope: null`) does not create team membership.

## User flow

```mermaid
flowchart TD
    A["Invitee submits invitation acceptance"] --> B{"Kit accepts token for this account?"}
    B -->|No| C["Acceptance is refused"]
    B -->|Yes| D{"Invitation is scoped?"}
    D -->|No| I["Run optional host acceptance callback"]
    D -->|Yes| F{"Scope key canonical?"}
    F -->|No| G["Transaction rolls back"]
    F -->|Yes| H{"Known non-owner role and not already a member?"}
    H -->|No| G
    H -->|Yes| J["Membership is created with invitation role"]
    J --> I
    I --> K["Accept global invitation or scoped invitation with membership when transaction succeeds"]
```

## Code flow

Scope: package behavior; the host owns team records, page rendering, route placement, record-level policy, and trusted operations outside the package callback.

```mermaid
flowchart TD
    A["onInvitationAccepted(user, invitation, trx)"] --> B{"Non-null invitation scope?"}
    B -->|No| C["skip membership creation"]
    C --> F
    B -->|Yes| D["validate canonical scope key"]
    D --> E["memberships.acceptInvitation uses same trx; refuse invalid role or existing membership"]
    E --> F["run optional host callback"]
    F --> G["Account Kit commits global acceptance or scoped acceptance with membership"]
```

**Code references:** [acceptance callback](../account_kit/main.ts), [trusted method](../src/memberships.ts)
