# Releasing

1. On a branch, bump `version` in `package.json` and turn `## Unreleased` into
   `## <version> - <YYYY-MM-DD>` (add a new empty `## Unreleased` above it).
2. Update the `README.md` and `README-AGENTS.md` install commands, asset filename and release-note
   link to that exact version. To move to another Account Kit release, run
   `pnpm bump:account-kit <version>`: it rewrites the URL, exact peer and lockfile entries together
   and lists any line still naming the old version. An Access Control version bump does not select
   a new Account Kit release automatically.
3. If the release adds a migration stub, add its `{ name, sha256 }` entry to
   `stubs/migrations/released.json` and a `### Migrations` subsection to the changelog.
4. Merge the PR (owner-authorised).
5. Actions → release → Run workflow (on `main`).

Nothing else is manual. The release is a GitHub prerelease with the tarball attached; its notes
carry the install command and the SHA-256. `bash bin/release_check.sh` runs the same gate locally.
After publication, follow the release verification steps in [verification](verification.md).
