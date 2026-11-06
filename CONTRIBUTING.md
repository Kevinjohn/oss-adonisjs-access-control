# Contributing

Thanks for helping. Bug reports and documentation fixes are welcome.

## Before you start

- For a bug, open an issue with a reproduction first, unless the fix is one line.
- For a feature or behaviour change, open an issue to agree on the shape before writing code.
- Report security problems privately as described in [SECURITY.md](SECURITY.md). Do not open a
  public issue.

## Project principles

Every change follows these principles.

- **Built for everyone who uses AdonisJS.** Follow the open-source AdonisJS packages and starter
  kits for names, shapes and behaviour. Match AdonisJS Plus only where that costs nothing; Plus
  compatibility is not a goal and never outweighs consistency for open-source users.
- **The application owns its language.** Errors carry stable codes and English fallback messages.
  If the request context has `i18n`, the package looks up `errors.<code>` there. The package ships
  no translations, loader, locale detection or language setting.
- **The application owns its domain.** Teams, record-level rules, UI and audit storage belong to
  the app. The package owns memberships, the role matrix and their invariants. See the
  [build specification](docs/maintainers/design/spec-access-control.md) for the invariants.

## Local setup

You need Node.js 24 and pnpm. The repository pins Node 24 in `.nvmrc`; `better-sqlite3` is compiled
for it and the tests fail under another Node version.

```sh
nvm use
pnpm install
pnpm quick:test
```

## Checks

`pnpm check` runs formatting, lint, types, SQLite tests, build and built exports. `--full` adds
PostgreSQL, MySQL, coverage, the docs build and the packed SQLite consumer.

Run the repository scripts, not bare tools. They carry the flags used by the release gate.

| Command                   | What it does                                               |
| ------------------------- | ---------------------------------------------------------- |
| `pnpm format:check`       | Checks tracked files with Prettier without writing changes |
| `pnpm lint`               | Runs ESLint                                                |
| `pnpm typecheck`          | Type-checks without emitting files                         |
| `pnpm quick:test`         | Runs the Japa suite against SQLite                         |
| `pnpm test`               | Runs the SQLite suite with coverage thresholds             |
| `pnpm test:pg`            | Runs the suite against local PostgreSQL 16                 |
| `pnpm test:mysql`         | Runs the suite against the `DB_*` MySQL server             |
| `pnpm build`              | Compiles the package to `build/`                           |
| `pnpm test:built-exports` | Checks package exports from the compiled output            |
| `pnpm test:consumer`      | Installs the packed package in a consumer application      |
| `pnpm docs:build`         | Builds the documentation site and checks links             |

`pnpm test:pg` needs PostgreSQL 16. To use your own server, set `DB_CLIENT=pg`, `DB_HOST`,
`DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_DATABASE`, then run `pnpm quick:test`.
`pnpm test:mysql` reads the same variables with `DB_CLIENT=mysql2`.

Changes to database code, locks or migrations should pass on SQLite, PostgreSQL and MySQL. The
`checks` workflow runs all three for every pull request.

The _Tested against_ table in `README.md` mirrors `.github/workflows/checks.yml` and
`compat.yml`; change them in the same PR.

## Code layout

- `src/` holds the configuration, rules, membership service, locks, errors and payload.
- `middleware/` and `account_kit/` hold the exported scope middleware and Account Kit callbacks.
- `providers/`, `services/`, `commands/` and `stubs/` hold the provider, container service, Ace
  commands and configure templates.
- `tests/` mirrors the source. Shared fixtures live in `tests/helpers/`.

See the [maintainer source map](docs/maintainers/source-map.md) for module ownership and focused
tests. [AGENTS.md](AGENTS.md) describes the file responsibility and folder rules.

## Planning files

The accepted contract lives in [`docs/maintainers/design/`](docs/maintainers/design/). Private
working plans belong in the local, gitignored `plans/` directory; do not commit them.

## Pull requests

- Keep each pull request focused on one change.
- Add or update tests. A bug fix should include a test that fails without the fix.
- Document user-facing changes and add a line under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md).
- Keep public error codes stable; changing one requires a breaking changelog entry.
- Write imperative commit messages that describe the change, signed off with `git commit -s`.

## Repository-specific

- The [build specification](docs/maintainers/design/spec-access-control.md) is the contract.
  Section 1 (repository rules) is strict; a deviation needs the owner's approval and a line in
  [conventions](docs/maintainers/conventions.md).
- Only lock in the order of specification section 4.2. Ascending means code-unit order of
  `String(key)`.
- The reserved keys `members:list`, `members:manage` and `invitations:manage` are always present.
- Released migration stubs are immutable (specification section 17.1).
- Error codes are `E_ACCESS_CONTROL_*` with the response shape from specification section 6.

## Code of conduct

Everyone taking part in this project follows the [code of conduct](CODE_OF_CONDUCT.md).
