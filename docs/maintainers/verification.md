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

## Dependency audit assessment

Assessment date: 2026-11-06. This snapshot covers the committed root and `examples/consumer`
lockfiles at `8a65c341bc634e3d35856219151f84d71f41289a`, using Node 24.22.2 and pnpm 11.23.0.
`pnpm audit --json` reports 12 advisory IDs in the root graph and two in the consumer graph: 14
advisory and graph occurrences. No dependency version changes are selected for this snapshot. The
root has no runtime `dependencies`; every finding is on a development or peer path, which does not
assess an installed consumer or establish production safety.

The table preserves each advisory ID; each link holds the advisory's affected conditions and
remediation details. A tooling path is not proof that every use is unreachable.

| Advisory                                                                 | Resolved package   | Graph and parent path                                                                | Outcome                                                                         |
| ------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | `esbuild@0.21.5`   | Root: VitePress → Vite → esbuild (also via plugin-vue)                               | Deferred: keep the stable documentation toolchain.                              |
| [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) | `vite@5.4.21`      | Root: VitePress → Vite (also via plugin-vue)                                         | Deferred: keep Vite 5; no major or prerelease migration.                        |
| [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) | `vite@5.4.21`      | Root: VitePress → Vite (also via plugin-vue)                                         | Deferred: keep Vite 5; no major or prerelease migration.                        |
| [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv) | `vite@5.4.21`      | Root: VitePress → Vite (also via plugin-vue)                                         | Deferred: keep Vite 5; no major or prerelease migration.                        |
| [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw) | `vite@5.4.21`      | Root: VitePress → Vite (also via plugin-vue)                                         | Deferred: keep Vite 5; no major or prerelease migration.                        |
| [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) | `vite@5.4.21`      | Root: VitePress → Vite (also via plugin-vue)                                         | Deferred: keep Vite 5; no major or prerelease migration.                        |
| [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) | `vite@5.4.21`      | Root: VitePress → Vite (also via plugin-vue)                                         | Deferred: keep Vite 5; no major or prerelease migration.                        |
| [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) | `vite@5.4.21`      | Root: VitePress → Vite (also via plugin-vue)                                         | Deferred: keep Vite 5; no major or prerelease migration.                        |
| [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | `vite@5.4.21`      | Root: VitePress → Vite (also via plugin-vue)                                         | Deferred: keep Vite 5; no major or prerelease migration.                        |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | `deepmerge@4.3.1`  | Root and consumer: Lucid → deepmerge (directly and through Auth and Session)         | Upstream-blocked: no patched release in the audit metadata.                     |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | `glob@13.0.6`      | Root: c8 → test-exclude → glob                                                       | Retained pending a compatible coverage parent update; no forced major override. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | `minimatch@10.2.6` | Root and consumer: Assembler → ts-morph → @ts-morph/common → minimatch, through Core | Retained pending compatible parent updates; no forced major override.           |

Deepmerge has a real dependency path through Lucid; application input and merge usage still
require assessment in the consuming application. The eight Vite 5 findings and the esbuild
finding apply to the documentation development server; keep it on trusted networks and review
each advisory's conditions. They are not closed by calling the dependency a development tool.

### Follow-up register

- Reassess a supported Lucid release when it removes or patches deepmerge.
- Reassess supported ESLint, TypeDoc, ts-morph and coverage parent releases when they adopt
  patched minimatch and glob versions; test their actual file selection.
- Reconsider VitePress only when a compatible stable security path is available or a toolchain
  migration is separately chosen.

This register creates no upstream issue, subscription or scheduled monitoring. Refresh the audit
before a release and replace this section with the new dated snapshot.
