# Verification

Use Node 24 and the pnpm version pinned in `package.json`. Run the repository scripts so the
same flags apply locally and in CI:

```sh
pnpm check
pnpm check --full
```

The quick profile checks formatting, lint, types, SQLite tests, the build and built exports. The
full profile adds PostgreSQL, MySQL, coverage, the docs build and the packed SQLite consumer.
`bin/check_profiles.ts` defines the steps. `pnpm check:changed [base]` selects checks while
working; it does not replace the full gate.

`pnpm test:pg` starts a disposable PostgreSQL 16 cluster through `bin/pg.sh`. Set `DB_PORT` to an
unused port when another local cluster is running. For an existing server, set `DB_CLIENT=pg`,
`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_DATABASE`, then run `pnpm quick:test`.
`pnpm test:mysql` runs the suite with `DB_CLIENT=mysql2` against the `DB_*` server.

For documentation changes, `pnpm docs:build` checks the VitePress site and generated API pages.
The documentation specs verify exact tracked Markdown paths, heading anchors, navigation and
links in packed Markdown. The release workflow calls `checks` and `compat` before its local
[tag, changelog, build and tarball gate](releasing.md).

## Consumer process cleanup

The packed consumer harness applies a 10-minute timeout to each command. On timeout or the first
SIGINT/SIGTERM, it sends TERM to the command's owned process group, waits up to five seconds,
sends KILL if the group remains, and waits up to five more seconds for reap. A second signal
escalates the active owned group; the first interrupt determines exit status 130 or 143.

With `CONSUMER_PG_EXTERNAL=1`, the harness leaves the externally provided PostgreSQL service
running and only drops its own uniquely named schema.

## Release verification

After each release is published, install the advertised README tarball in a fresh AdonisJS 7 app
with Account Kit, run `configure`, migrate, run `node ace access-control:doctor` (expect exit 0)
and one scoped request with a Bouncer check. Record the result below.

| Version  | Date | Outcome |
| -------- | ---- | ------- |
| none yet |      |         |

## Changelog link policy

The default relative-path and heading checks in `tests/docs_links.spec.ts` exclude
`CHANGELOG.md`, because historical relative destinations can age out. The separate check of
GitHub links into this repository's `main` tree still includes the changelog. These checks do
not fetch external URLs.
