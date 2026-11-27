# US-ACCESS-23 — Resend a pending invitation

As an active member authorized to manage invitations, I want to resend a pending invitation so that authorized teammates can remind invitees without widening invitation authority.

**Status:** Current when Account Kit invitations are enabled and the relevant Access Control callback is wired
**Access:** Inviter must be admitted if enabled, active in canonical invitation scope, have `invitations:manage`, and be permitted to manage the invitation’s role.
**Entry:** Account Kit `invitations.resend` invokes `authorize.manageInvitation` and then `authorize.invite` for the invitation's role and scope, from the Access Control callbacks. Kit runs both in a preflight and again inside the write transaction.
**Documentation:** [account-kit.md](../docs/guide/account-kit.md)
**Source:** [src/account_kit/main.ts](../src/account_kit/main.ts)
**Coverage:** [`tests/account_kit.spec.ts`](../tests/account_kit.spec.ts)

## Acceptance criteria

- Call `invitations.resend({ actorId, invitationId })` with a positive safe integer invitation ID. Account Kit refuses a recipient address that is already registered. A retained expired invitation can also be renewed by this action.
- Callback checks the invitation’s own canonical scope and role, not a client-selected replacement.
- Unknown role, owner role, role above actor, missing membership/permission or failed admission denies resend.
- Access Control authorizes only; Account Kit replaces the token and expiry in the write transaction, then sends the replacement invitation notification after commit. Delivery can fail after the old link has been invalidated.
- Account Kit reports a denial from either callback as a not-found error (`E_ACCOUNT_KIT_INVITATION_MANAGEMENT_DENIED`, status 404).

## User flow

```mermaid
flowchart TD
    A["Member requests invitation resend"] --> B{"Can manage this invitation in its scope?"}
    B -->|No| C["Account Kit refuses resend"]
    B -->|Yes| D["Account Kit rotates the link and attempts notice"]
    D -->|Delivery fails| E["Old link remains invalid; host handles delivery failure"]
```

## Code flow

Scope: package behaviour and host callback boundary; the application owns its screens and scope records; Account Kit owns the transaction and its commit, and the package callback only authorizes.

```mermaid
flowchart TD
    A["Kit preflight or write transaction invokes authorize.manageInvitation"] --> B["Check role, canonical scope, active membership, permission, optional admission and rank"]
    B --> D{"Allowed?"}
    D -->|No| E["Return false; Kit refuses with not-found error"]
    D -->|Yes| C["Kit invokes authorize.invite; repeat the checks with invitation role and scope"]
    C --> Q{"Allowed?"}
    Q -->|No| E
    Q -->|Yes| P{"Preflight?"}
    P -->|Yes| W["Commit preflight; consume throttles; start write transaction and recheck"]
    W --> A
    P -->|No| R{"Recipient address already registered?"}
    R -->|Yes| X["Kit refuses before rotation"]
    R -->|No| F["Kit updates token and expiry and commits"]
    F --> G["Kit attempts provision and lifecycle follow-up"]
    G -->|Follow-up fails| H["Error propagates; rotation remains committed"]
```

**Code references:** [manageInvitation and invite callbacks](../src/account_kit/main.ts), [invitation rules](../docs/guide/account-kit.md), [Account Kit resend](https://github.com/Kevinjohn/oss-adonisjs-account-kit/blob/d01b742c5416b747b300402c1669f5aaf6bba290/src/invitation_management.ts).
