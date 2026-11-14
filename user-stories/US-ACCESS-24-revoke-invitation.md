# US-ACCESS-24 — Revoke a pending invitation

As an active member authorized to manage invitations, I want to revoke a pending invitation so that authorized teammates can revoke invitations that should no longer be accepted.

**Status:** Current when Account Kit callback integration is configured
**Access:** Inviter must be admitted if enabled, active in canonical invitation scope, have `invitations:manage`, and be permitted to manage the invitation’s role.
**Entry:** Account Kit invitation revoke/manage action invokes `authorize.manageInvitation` from Access Control callback.
**Documentation:** [account-kit.md](../docs/guide/account-kit.md)
**Source:** [account_kit/main.ts](../account_kit/main.ts)
**Coverage:** [`tests/account_kit.spec.ts`](../tests/account_kit.spec.ts)

## Acceptance criteria

- Callback checks the invitation’s own canonical scope and role before allowing revoke.
- Unknown role, owner role, role above actor, missing membership/permission or failed admission denies revoke.
- Access Control authorizes only; Account Kit performs the revocation.

## User flow

```mermaid
flowchart TD
    A["Member chooses to revoke a pending invitation"] --> B{"Can manage this invitation?"}
    B -->|No| C["Revocation is refused"]
    B -->|Yes| D["Invitation can no longer be accepted"]
```

## Code flow

Scope: package behavior and host callback boundary; the application owns its screens and scope records; Account Kit owns the transaction and its commit, and the package callback only authorizes.

```mermaid
flowchart TD
    A["Account Kit invokes authorize.manageInvitation"] --> B["Access Control resolves canonical scope and active membership"]
    B --> C["check admission, invitations:manage and invitation role rank"]
    C --> D{"Allowed?"}
    D -->|No| E["return false; Kit refuses"]
    D -->|Yes| F["Kit revokes invitation"]
```

**Code references:** [manageInvitation callback](../account_kit/main.ts), [invitation rules](../docs/guide/account-kit.md)
