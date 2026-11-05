# Changelog

## Unreleased

### Added

- `defineAccessControl` with boot validation of roles, permission keys, reserved keys, owner role,
  table names and key types; the frozen `AccessControl` instance exposes the pure rules (`rank`,
  `can`, `permissionsFor`, `assignableRoles`, `canManage`, `canAssign`, `canAdministerIdentity`),
  the public types, `AccessControlError` and the `E_ACCESS_CONTROL_*` code table.
- Scaffold the repository from the sibling package template: toolchain, checks, CI workflows on
  SQLite, PostgreSQL and MySQL, documentation site, maintainer records and the public export
  map with the `configure` hook and `stubsRoot`.
