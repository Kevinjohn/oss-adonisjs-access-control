# US-ACCESS-10 — Accept a scoped invitation

As an invited account holder, I want to accept a scoped invitation so that acceptance creates the access promised by the invitation.

**Status:** Current when Account Kit acceptance callback is wired
**Access:** Invitation token/recipient validation is owned by Account Kit; acceptance creates the account and is refused for an already registered email. Scoped membership is created only for a canonical configured scope.
**Entry:** Account Kit `invitations.accept` consumes the token, creates the account, then calls the `onInvitationAccepted` callback. The callback also runs for each pending invitation matched to a newly confirmed address: social sign-up with a provider-verified email, account activation, and a password reset that confirms a never-confirmed account.
**Documentation:** [account-kit.md](../docs/guide/account-kit.md)
**Source:** [account_kit/main.ts](../account_kit/main.ts)
**Coverage:** [`tests/account_kit.spec.ts`](../tests/account_kit.spec.ts)

## Acceptance criteria

- Accepting by token creates the account; a token for an already registered email is refused and no account is created. Matched invitations (social sign-up, activation, confirming password reset) run the same callback for an account that already exists.
- For a scoped invitation, scope must use canonical configured key spelling; invalid scope is refused.
- For scoped invitations, trusted `acceptInvitation` refuses unknown/owner roles, a deleted scope (`E_ACCESS_CONTROL_SCOPE_NOT_FOUND`) and existing membership, otherwise creates membership inside the Account Kit transaction. Any refusal rolls back the whole acceptance, so no account is left behind. The optional host callback runs for both scoped and global invitations in that transaction.
- Global invitation (`scope: null`) does not create team membership.

## User flow

```mermaid
flowchart TD
    A["Invitee submits invitation acceptance"] --> B{"Token valid and email not yet registered?"}
    B -->|No| C["Acceptance is refused; no account is created"]
    B -->|Yes| B2["Kit creates the account"]
    B2 --> D{"Invitation is scoped?"}
    M["Confirmed address matches pending invitations: social sign-up, activation, password reset"] --> D
    D -->|No| I["Run optional host acceptance callback"]
    D -->|Yes| F{"Scope key canonical?"}
    F -->|No| G["Transaction rolls back"]
    F -->|Yes| H{"Known non-owner role, scope exists and not already a member?"}
    H -->|No| G
    H -->|Yes| J["Membership is created with invitation role"]
    J --> I
    I --> K["Transaction commits: account and any membership exist"]
```

## Code flow

Scope: package behavior, entered from Account Kit acceptance and matched-invitation paths; the host owns team records, page rendering, route placement, record-level policy, and trusted operations outside the package callback.

```mermaid
flowchart TD
    K1["Kit invitations.accept: consume token, refuse registered email, create account"] --> A
    K2["Kit matchInvitation: social sign-up, activation, confirming reset"] --> A
    A["onInvitationAccepted(user, invitation, trx)"] --> B{"Non-null invitation scope?"}
    B -->|No| C["skip membership creation"]
    C --> F
    B -->|Yes| D["validate canonical scope key"]
    D --> E["memberships.acceptInvitation uses same trx; refuse invalid role, deleted scope or existing membership"]
    E --> F["run optional host callback"]
    F --> G["Account Kit commits global acceptance or scoped acceptance with membership"]
```

**Code references:** [acceptance callback](../account_kit/main.ts), [trusted method](../src/memberships.ts), [scope lock](../src/locks.ts), Account Kit `node_modules/@kevinjohn/adonisjs-account-kit/build/account_kit-DJQDBFqq.js:1667-1678` (accept) and `:67-80` (matchInvitation)
