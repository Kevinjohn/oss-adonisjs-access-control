# Changelog

## Unreleased

### Migrations

- `create_memberships`: the memberships table with `RESTRICT` foreign keys to the users and scope
  tables, a unique `(scope_id, user_id)` key and the paging index. Recorded in
  `stubs/migrations/released.json`.

### Added

- Membership service (`AccessControl.memberships` once a database is attached): `find`,
  `listForUser`, `listForScope` with cursor paging, `add`, `changeRole`, `setStatus`, `remove`,
  `leave`, `transferOwnership`, and the trusted `createFirstMember`, `acceptInvitation`,
  `identityRoles`, `assertCanAdministerIdentity`, `prepareAccountDeletion`, `removeAllForScope`
  and `exportFor`. Every write runs under the lock process (user rows ascending by `String(key)`,
  then the scope row) and reports through `onMembershipChanged` inside the transaction.
- Transaction runner bridge: Account Kit's `transaction` export when the installed kit ships it,
  otherwise a local runner with the same contract that serialises SQLite writers on the kit's
  `account_transaction_lock` row and runs MySQL at READ COMMITTED with a UTC connection.
- `AccessControlError.handle`: the table status, `Cache-Control: no-store` and
  `{ errors: [{ code, message }] }`, translated through `ctx.i18n` when present.
- `docs/reference/errors.md` listing every code.
- `defineAccessControl` with boot validation of roles, permission keys, reserved keys, owner role,
  table names and key types; the frozen `AccessControl` instance exposes the pure rules (`rank`,
  `can`, `permissionsFor`, `assignableRoles`, `canManage`, `canAssign`, `canAdministerIdentity`),
  the public types, `AccessControlError` and the `E_ACCESS_CONTROL_*` code table.
- Scaffold the repository from the sibling package template: toolchain, checks, CI workflows on
  SQLite, PostgreSQL and MySQL, documentation site, maintainer records and the public export
  map with the `configure` hook and `stubsRoot`.
