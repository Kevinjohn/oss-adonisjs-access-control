# Access Control documentation

Access Control adds team memberships and a ranked role matrix to an AdonisJS 7 application built
on Account Kit. The application declares its roles and permission keys in code; the package stores
memberships, enforces the management rules and generates Bouncer abilities for the current
request's membership.

## Get started

The user guides (setup, roles, rules, memberships, Bouncer, Account Kit and the client payload)
arrive with the documentation milestone. Until then the
[technical specification](https://github.com/Kevinjohn/oss-adonisjs-access-control/blob/main/docs/maintainers/design/spec-access-control.md)
is the reference for configuration, rules, the database contract and the public API.

## Reference

- [Public API reference](reference/README.md): supported package imports and the generated API
  pages.
- [Recipes](recipes/index.md): task-focused examples, added as the guides land.

The package is a pre-release distributed as GitHub prereleases and is not published to a package
registry. The [maintainer records](https://github.com/Kevinjohn/oss-adonisjs-access-control/tree/main/docs/maintainers)
hold the conventions, verification and release procedure.
