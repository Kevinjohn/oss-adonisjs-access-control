# US-ACCESS-02 — Enter an authorized team-scoped route

As an authenticated account holder, I want to enter an authorized team-scoped route so that each request is checked against the current account and scope.

**Status:** Current when host Account Kit/authentication and scope middleware are mounted
**Access:** Effective user from `ctx.auth.user`; must have active membership and configured role. Account Kit must precede scope where credential revision, activation or admission checks are required.
**Entry:** Host route uses Account Kit managed-account/admission middleware, then `middleware.scope()`; Bouncer checks permission key.
**Documentation:** [bouncer.md](../docs/guide/bouncer.md)
**Source:** [middleware/main.ts](../middleware/main.ts)
**Coverage:** [`tests/middleware.spec.ts`](../tests/middleware.spec.ts)

## Acceptance criteria

- Scope defaults to `ctx.params.scopeId`; host may supply `resolveScope`.
- Missing effective user, malformed scope, no membership, suspended membership or unknown role fails with the same forbidden error.
- Success sets `ctx.membership`; generated ability resolves it at check time and matches it to Bouncer subject.
- Permission ability answers role-level permission only; record-level policies remain app-owned.

## User flow

```mermaid
flowchart TD
    A["Account holder requests a team route"] --> B["Host middleware resolves effective account"]
    B --> C["Scope middleware loads membership"]
    C --> D{"Active membership and known role?"}
    D -->|No| E["Uniform forbidden response"]
    D -->|Yes| F["Bouncer checks permission key"]
    F --> G{"Role satisfies key?"}
    G -->|No| H["Authorization denied"]
    G -->|Yes| I["App record policy and handler run"]
```

## Code flow

Scope: package behavior; the host owns team records, page rendering, route placement, record-level policy, and trusted operations outside the package callback.

```mermaid
flowchart TD
    A["Account Kit managed-account or admission middleware"] --> B["ctx.auth.user is effective guard identity"]
    B --> C["ScopeMiddleware.handle resolves scope and calls memberships.find"]
    C --> D{"active membership and configured role?"}
    D -->|No| E["AccessControlError FORBIDDEN"]
    D -->|Yes| F["set ctx.membership; call next"]
    F --> G["AccessControl.abilities resolver reads ctx.membership"]
    G --> H["Bouncer checks role permission; app policy checks record"]
```

**Code references:** [scope middleware](../middleware/main.ts), [abilities](../src/abilities.ts), [guide](../docs/guide/bouncer.md)
