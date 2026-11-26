# Releasing

1. On a branch, bump `version` in `package.json` and turn `## Unreleased` into
   `## <version> - <YYYY-MM-DD>` (add a new empty `## Unreleased` above it).
2. Update the `README.md` and `README-AGENTS.md` install commands, asset filename and release-note
   link to that exact version. To move to another Account Kit release, run
   `pnpm bump:account-kit <version>`: it rewrites the URL, exact peer and lockfile entries together
   and lists any line still naming the old version. If interrupted, rerun the same command;
   it resumes the checked plan in `tmp/account-kit-bump-plan.json` and refuses planned files
   changed independently. Run only one bump at a time, and keep planned files free of
   outside edits while it runs. A rerun checks complete file contents before resuming;
   it does not merge manual edits into planned files. An Access Control version bump does not select
   a new Account Kit release automatically.
3. If the release adds a migration stub, add its `{ name, bodySha256 }` entry to
   `stubs/make/migration/released.json` and a `### Migrations` subsection to the changelog. Hash the exact bytes after the first line
   (the stub destination directive), including the following blank line.
4. Merge the PR once its review is complete and every check on its head has passed.
5. The owner runs Actions → release → Run workflow (on `main`). Publishing and tagging stay owner
   actions.

Nothing else is manual. The release is a GitHub prerelease with the tarball attached; its notes
carry the install command and the SHA-256. `pnpm release` runs the same gate locally.
After publication, follow the release verification steps in [verification](verification.md).

## Adopting the next Account Kit transaction API

The current adapter in `src/kit_transaction.ts` targets the published Account Kit 0.8.0
`/transaction` functions. When adopting the release that introduces `TransactionManager`,
change the adapter and its callers to use a manager bound to the Lucid database for transaction
execution and row locking. Supply an explicit timestamp to `sqlTimestamp(trx, at)` at the current
timestamp call sites so they retain their existing sampling behavior. Update the exact peer, the
dev archive, lockfiles and packed consumer together. Exercise nested transactions, SQLite write
serialization and the PostgreSQL and MySQL row-locking paths with the new release. The current
checks cover the released 0.8.0 contract.
