# US-ACCESS-20 — Protect scope ownership during account deletion

As an application integrator, I want to protect scope ownership during account deletion so that account deletion removes its memberships without leaving an ownerless scope.

**Status:** Current when Account Kit account deletion is enabled and the Access Control deletion hook is wired
**Access:** Account Kit owns deletion; Access Control callback refuses deletion while account has active owner membership.
**Entry:** Account Kit `accountData.delete({ actorId, currentPassword?, recentProof? })` invokes the `onAccountDeletingTransaction` callback, which calls `memberships.prepareAccountDeletion` in the Kit transaction.
**Documentation:** [account-kit.md](../docs/guide/account-kit.md)
**Source:** [account_kit/main.ts](../account_kit/main.ts)
**Coverage:** [`tests/memberships_trusted.spec.ts`](../tests/memberships_trusted.spec.ts)

## Acceptance criteria

- Membership rows are removed in the Kit deletion transaction when no active owner rule blocks it.
- If account owns any scope as an active member, deletion raises `E_ACCESS_CONTROL_LAST_OWNER`; host transfers ownership first.
- The callback does not delete host scope or business records.

## User flow

```mermaid
flowchart TD
    A["Account holder requests account deletion"] --> B{"Account is active owner of any scope?"}
    B -->|Yes| C["Deletion is refused; transfer ownership first"]
    B -->|No| D["Account Kit deletes account and memberships together"]
```

## Code flow

Scope: package behaviour and host callback boundary; the application owns its screens and scope records; Account Kit owns the deletion transaction and its commit.

```mermaid
flowchart TD
    A["Account Kit confirms actor and holds user lock; calls onAccountDeletingTransaction(user, trx)"] --> B["memberships.prepareAccountDeletion requires same trx"]
    B --> C["read memberships and lock involved scopes"]
    C --> D{"Owner role configured and any active owner membership?"}
    D -->|Yes| E["throw LAST_OWNER; Kit transaction rolls back"]
    D -->|No| F["delete memberships and emit membership.removed with reason account_deleted"]
    F --> G["Kit deletes account rows and user in same trx and commits"]
    G --> H["Kit sends deletion notice and lifecycle event after commit"]
```

**Code references:** [callback](../account_kit/main.ts), [prepareAccountDeletion](../src/memberships.ts), [Account Kit deletion](https://github.com/Kevinjohn/oss-adonisjs-account-kit/blob/becffc90271b79c3ce6d2c1dfe0e0b3e871a9fc8/src/account_deletion.ts#L11-L39).
