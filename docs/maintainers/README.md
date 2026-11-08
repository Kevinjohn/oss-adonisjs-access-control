# Maintainer records

These pages support development and release review; they are excluded from the user docs site and
package archive.

- [Requirement ledger](requirement-ledger.md): each specification requirement mapped to named
  evidence, with implemented, verified and shipped status kept separate.
- [Source map](source-map.md): task-oriented module and test navigation.
- [Conventions](conventions.md): repository layout, toolchain and release practices.
- [Verification](verification.md): local checks, database gates and release verification.
- [Releasing](releasing.md): the release procedure, including pinned artifact references.
- [Design records](design/): the build specification and the design history behind it.
- [Adoption record: Capacity Lens](adoption-capacity-lens.md): how a single-company application
  uses the package and what the package lacked.

## Monthly

- Check each `uses:` in `.github/workflows/*.yml` for a newer release. Every action is pinned to
  a commit SHA with the release tag in a trailing comment (`actions/checkout@<sha> # v7`); bump
  the SHA and the comment together, in one PR.
- Check open Dependabot alerts (Security tab).
