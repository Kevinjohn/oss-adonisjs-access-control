# US-ACCESS-17 — List pending invitations

As an active member allowed to manage invitations, I want to list pending invitations so that I can review invitations for my scope.

**Status:** Current when Account Kit invitations are enabled and the relevant Access Control callback is wired
**Access:** Actor must be admitted when admission checks are on, active in the canonical current scope, and have `invitations:manage`.
**Entry:** Account Kit `invitations.list({ actorId, scope, limit?, cursor? })` invokes `accessControlKitCallbacks().authorize.listInvitations`.
**Documentation:** [account-kit.md](../docs/guide/account-kit.md)
**Source:** [account_kit/main.ts](../account_kit/main.ts)
**Coverage:** [`tests/account_kit.spec.ts`](../tests/account_kit.spec.ts)

## Acceptance criteria

- Listing requires an active membership in the canonical current scope with `invitations:manage`; admission is also checked when enabled.
- A scope is required for authorization: a list call without `scope` reaches the callback with an empty context and is refused.
- Account Kit returns unexpired invitations for the authorized scope, ordered by creation time and ID. `limit` defaults to 25 and accepts integers from 1 to 100. An optional `cursor` resumes the page. The result contains `items` and `nextCursor` (null at the end). The host owns page rendering.

## User flow

```mermaid
flowchart TD
    A["Member requests pending invitations for a scope"] --> B{"Listing is authorized?"}
    B -->|No| C["Account Kit refuses listing"]
    B -->|Yes| D["Host receives invitation page"]
```

## Code flow

Scope: the package callback authorizes; Account Kit performs the invitation query and response.

```mermaid
flowchart TD
    A["Account Kit invitations.list validates page arguments and loads actor"] --> B["authorize.listInvitations(actor, context)"]
    B --> C["resolve active membership and canonical scope"]
    C --> D["check invitations:manage, then optional admission"]
    D --> E{"Allowed?"}
    E -->|No| F["return false; Kit refuses"]
    E -->|Yes| G["Kit queries unexpired scoped rows and returns items and nextCursor"]
```

**Code references:** [callbacks](../account_kit/main.ts), [membership rules](../docs/guide/rules.md), [Account Kit invitation listing](https://github.com/Kevinjohn/oss-adonisjs-account-kit/blob/d01b742c5416b747b300402c1669f5aaf6bba290/src/invitation_management.ts).
