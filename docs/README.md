# Access Control documentation

Access Control adds team memberships and a ranked role matrix to an AdonisJS 7 application built
on Account Kit. The application declares its roles and permission keys in code; the package stores
memberships, enforces the management rules and generates Bouncer abilities for the current
request's membership.

## Start here

- [Getting started](guide/getting-started.md): install and protect a first scoped route.
- [Recipes](recipes/index.md): focused examples for common tasks.
- [API reference](reference/README.md): supported package imports and the generated API pages.
- [Errors](reference/errors.md): every error code with its status, message and whether a user can
  reach it.
- [Troubleshooting](guide/troubleshooting.md): symptoms, causes and fixes.

## Guides

- [Setup](guide/setup.md): install, `configure`, the two manual steps and the doctor.
- [Roles and permission keys](guide/roles.md): the configuration, boot validation and the
  deployment contract.
- [Management rules](guide/rules.md): who may change, suspend, remove or leave, in prose.
- [Memberships](guide/memberships.md): the service, trusted operations, events and transactions.
- [Scope middleware and Bouncer](guide/bouncer.md): scoped routes and generated abilities.
- [Account Kit](guide/account-kit.md): invitation, acceptance, deletion and export callbacks.
- [Client payload](guide/client.md): what a frontend receives and the type-only imports.
- [Changing roles and the doctor](guide/changing-roles.md): renames, owner changes and upgrades.
- [Adopting an existing table](guide/adopting.md): moving memberships an application already
  stores into the package's table, or replacing a home-grown access layer.

## Project information

- [Maintainer guide](maintainers/README.md)
- [Technical specification](maintainers/design/spec-access-control.md)
- [Security policy](../SECURITY.md)
- [Contributing](../CONTRIBUTING.md)

The package is a pre-release distributed as GitHub prereleases and is not published to a package
registry.
