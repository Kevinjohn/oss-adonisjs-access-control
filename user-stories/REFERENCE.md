# Reference

## Actors and boundaries

- **Authenticated account**: identity left on `ctx.auth.user` by the host's authentication middleware or Account Kit managed-account middleware. Account Kit should run first where credential revision, active-account or admission checks are required. `middleware.auth()` alone does not provide those checks. Under Masquerade, the effective business guard user is the subject whose membership and Bouncer ability are evaluated.
- **Team/scope member**: membership is per user and configured scope with role and active/suspended state. The package does not define teams, team UI, record-level authorization or audit storage.
- **Application**: owns scope creation/deletion, Bouncer policies, route placement and trusted-operation authorization. Scope middleware establishes membership; Bouncer key checks establish role permission; record policies remain app-owned.
- **Operator**: configures typed role/permission matrix, migrations, provider, Account Kit callbacks, and adoption from app-owned membership data.

## Source map

- Public entry/configuration and rule API: [`index.ts`](../index.ts), [`src/define.ts`](../src/define.ts), [`src/rules.ts`](../src/rules.ts).
- Membership lifecycle and transaction/locks: [`src/memberships.ts`](../src/memberships.ts), [`src/locks.ts`](../src/locks.ts), [`src/kit_transaction.ts`](../src/kit_transaction.ts).
- Scope entry and permission evaluation: [`middleware/main.ts`](../middleware/main.ts), [`src/abilities.ts`](../src/abilities.ts).
- Client membership projection: [`src/payload.ts`](../src/payload.ts).
- Error codes, statuses and response handler: [`src/errors.ts`](../src/errors.ts); instance binding (`attach`): [`src/define.ts`](../src/define.ts), [`providers/access_control_provider.ts`](../providers/access_control_provider.ts).
- Account Kit invitation, deletion and export callbacks: [`account_kit/main.ts`](../account_kit/main.ts).
- Setup and diagnosis: [`configure.ts`](../configure.ts), [`src/doctor.ts`](../src/doctor.ts), [adoption guide](../docs/guide/adopting.md).
- User docs: [scope/Bouncer](../docs/guide/bouncer.md), [memberships](../docs/guide/memberships.md), [management rules](../docs/guide/rules.md), [Account Kit integration](../docs/guide/account-kit.md), [client payload](../docs/guide/client.md), [roles](../docs/guide/roles.md).

`Current` describes the source path subject to host authentication, role configuration and database setup; it is not a runtime test result. Team boundaries are application data and can have arbitrary configured key types.
