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

## Monthly

- Check each `uses:` in `.github/workflows/*.yml` for a newer release that matches its pin
  format (major tag such as `actions/checkout@v7`, or exact version such as
  `ossf/scorecard-action@v2.5.0`). Bump them in one PR.
- Check open Dependabot alerts (Security tab).
