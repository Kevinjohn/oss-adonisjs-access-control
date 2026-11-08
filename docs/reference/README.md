# Public API reference

Use the package entry points below for imports. The generated reference follows source modules to
show symbol signatures; those source paths are documentation locations, not supported import paths.

## Supported package imports

This reference describes the `0.1.4` pre-release. Its provider entry is
`@kevinjohn/adonisjs-access-control/access_control_provider`; `configure` registers that path.

| Import path                                                  | Use                                                                                                   | Public reference                                                                                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@kevinjohn/adonisjs-access-control`                         | Configuration (`defineAccessControl`), the `AccessControl` class, errors, `configure` and `stubsRoot` | <a href="/oss-adonisjs-access-control/reference/api/index/index">Core package</a>                              |
| `@kevinjohn/adonisjs-access-control/types`                   | Type-only imports for public contracts                                                                | <a href="/oss-adonisjs-access-control/reference/api/src/types/">Exported type reference</a>                    |
| `@kevinjohn/adonisjs-access-control/access_control_provider` | AdonisJS provider registered by `configure`                                                           | <a href="/oss-adonisjs-access-control/reference/api/providers/access_control_provider/">Provider reference</a> |
| `@kevinjohn/adonisjs-access-control/services/main`           | Container-resolved `AccessControl` singleton                                                          | <a href="/oss-adonisjs-access-control/reference/api/services/main/">Service reference</a>                      |
| `@kevinjohn/adonisjs-access-control/middleware`              | Scope middleware: resolves the current request's membership                                           | <a href="/oss-adonisjs-access-control/reference/api/middleware/main/">Middleware reference</a>                 |
| `@kevinjohn/adonisjs-access-control/account-kit`             | Account Kit callbacks: invitations, acceptance, account deletion and export                           | <a href="/oss-adonisjs-access-control/reference/api/account_kit/main/">Account Kit reference</a>               |
| `@kevinjohn/adonisjs-access-control/commands`                | Ace command discovery loader                                                                          | <a href="/oss-adonisjs-access-control/reference/api/commands/main/">Commands reference</a>                     |

The exports above are the complete supported surface. The root exports `defineAccessControl`,
`AccessControl`, `AccessControlError`, the `errors` namespace, `configure` and `stubsRoot`; the
subpath entries fill in milestone by milestone, as recorded in the changelog.

Every error code, status and message is listed in [Errors](errors.md).

## Generated signatures and imports

Generated pages may show internal or framework types in a public signature so TypeScript contracts
are readable. That does not make their source modules importable. Import package types from
`@kevinjohn/adonisjs-access-control/types` or another listed entry point, and do not deep-import
`src/` or other implementation paths. The package's
[declared export map](https://github.com/Kevinjohn/oss-adonisjs-access-control/blob/main/package.json)
is the authority for supported paths.
