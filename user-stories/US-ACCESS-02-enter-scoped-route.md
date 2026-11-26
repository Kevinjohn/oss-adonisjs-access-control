# US-ACCESS-02 — Enter an authorized team-scoped route

As an authenticated account holder, I want to enter an authorized team-scoped route so that each request is checked against the current account and scope.

**Status:** Current when host Account Kit/authentication and scope middleware are mounted
**Access:** Effective user from `ctx.auth.user`; must have active membership and configured role. Account Kit must precede scope where credential revision, activation or admission checks are required.
**Entry:** Host route uses Account Kit managed-account/admission middleware, then `middleware.scope()`; Bouncer checks permission key.
**Documentation:** [bouncer.md](../docs/guide/bouncer.md)
**Source:** [middleware/main.ts](../middleware/main.ts)
**Coverage:** [`tests/middleware.spec.ts`](../tests/middleware.spec.ts)

## Acceptance criteria

- Both package subpaths `./middleware` and `./scope_middleware` expose the named middleware class and the inline `scopeMiddleware` factory. A malformed input key becomes a forbidden response. Invalid persisted status or timestamps raise a configuration error from the membership reader; the middleware propagates that failure.

- Scope defaults to `ctx.params.scopeId`; host may supply `resolveScope`.
- Missing effective user, malformed scope, no membership, suspended membership or unknown role fails with the same forbidden error.
- Success sets `ctx.membership`; generated ability resolves it at check time and matches it to Bouncer subject.
- Permission ability answers role-level permission only; record-level policies remain app-owned.

- Generated Bouncer abilities use the permission key as the ability name. Guests, absent or suspended members, unknown roles and memberships belonging to another subject are denied. Edge can use colon-delimited keys and host abilities can coexist. See [Bouncer integration tests](../tests/abilities.spec.ts).

## User flow

```mermaid
flowchart TD
    A["Account holder requests a team route"] --> B["Host middleware resolves effective account"]
    B --> C["Scope middleware loads membership"]
    C --> D{"Active membership and known role?"}
    C --> X["Invalid stored status or timestamp: configuration error"]
    D -->|No| E["Uniform forbidden response"]
    D -->|Yes| F["Bouncer checks permission key"]
    F --> G{"Role satisfies key?"}
    G -->|No| H["Authorization denied"]
    G -->|Yes| I["App record policy and handler run"]
```

## Code flow

Scope: package behaviour; the host owns team records, page rendering, route placement, record-level policy, and trusted operations outside the package callback.

```mermaid
flowchart TD
    A["Account Kit managed-account or admission middleware"] --> B["ctx.auth.user is effective guard identity"]
    B --> C["ScopeMiddleware.handle resolves scope and calls memberships.findActive if a user is present"]
    C -->|Unexpected failure| X["Propagate the membership read failure"]
    C -->|Missing user, invalid key, no active member or unknown role| E["E_ACCESS_CONTROL_FORBIDDEN"]
    C -->|Active member with configured role| F["Set ctx.membership and call next"]
    F --> G["AccessControl.abilities resolver reads ctx.membership"]
    G --> H{"Active membership matches subject and satisfies permission?"}
    H -->|No| I["Bouncer denies"]
    H -->|Yes| J["App policy checks record"]
```

**Code references:** [scope middleware](../middleware/main.ts), [active membership lookup](../src/memberships.ts#L357), [abilities](../src/abilities.ts), [guide](../docs/guide/bouncer.md)
