# US-ACCESS-23 — Resend a pending invitation

As an active member authorized to manage invitations, I want to resend a pending invitation so that authorized teammates can remind invitees without widening invitation authority.

**Status:** Current when Account Kit callback integration is configured
**Access:** Inviter must be admitted if enabled, active in canonical invitation scope, have `invitations:manage`, and be permitted to manage the invitation’s role.
**Entry:** Account Kit invitation resend/manage action invokes `authorize.manageInvitation` from Access Control callback.
**Documentation:** [account-kit.md](../docs/guide/account-kit.md)
**Source:** [account_kit/main.ts](../account_kit/main.ts)
**Coverage:** [`tests/account_kit.spec.ts`](../tests/account_kit.spec.ts)

## Acceptance criteria

- Callback checks the invitation’s own canonical scope and role, not a client-selected replacement.
- Unknown role, owner role, role above actor, missing membership/permission or failed admission denies resend.
- Access Control authorizes only; Account Kit sends the replacement invitation notification.

## User flow

```mermaid
flowchart TD
    A["Member requests invitation resend"] --> B{"Can manage this invitation in its scope?"}
    B -->|No| C["Account Kit refuses resend"]
    B -->|Yes| D["Invitee receives a new invitation notice"]
```

## Code flow

Scope: package behavior and host callback boundary; the application owns its screens, scope records and transaction commit.

```mermaid
flowchart TD
    A["Account Kit invokes authorize.manageInvitation"] --> B["Access Control resolves canonical scope and active membership"]
    B --> C["check admission, invitations:manage and invitation role rank"]
    C --> D{"Allowed?"}
    D -->|No| E["return false; Kit refuses"]
    D -->|Yes| F["Kit resends invitation provision"]
```

**Code references:** [manageInvitation callback](../account_kit/main.ts), [invitation rules](../docs/guide/account-kit.md)
