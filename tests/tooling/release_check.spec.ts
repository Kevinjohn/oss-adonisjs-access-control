import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { repoRoot } from '../helpers/tracked_markdown.js'

test('released changelog headings use the form bin/release_check.sh requires', async ({
  assert,
}) => {
  const changelog = await readFile(join(repoRoot, 'CHANGELOG.md'), 'utf8')
  const headings = [...changelog.matchAll(/^## (.+)$/gm)].map(([, heading]) => heading)
  const released = headings.filter((heading) => heading !== 'Unreleased')
  assert.include(headings, 'Unreleased')
  assert.deepEqual(
    released.filter((heading) => !/^\S+ - \d{4}-\d{2}-\d{2}$/.test(heading)),
    []
  )
})

/** Run the release gate in a throwaway package with the given changelog; it builds and packs. */
async function releaseCheck(changelog: string, manifest: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'access_control_release_check_'))
  try {
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name: 'release-fixture',
        version: '9.9.9',
        scripts: { build: 'true' },
        ...manifest,
      })
    )
    await writeFile(join(directory, 'CHANGELOG.md'), changelog)
    const outputs = join(directory, 'github_output')
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_OUTPUT: outputs,
    }
    delete environment.GITHUB_ENV
    const result = spawnSync('bash', [join(repoRoot, 'bin/release_check.sh')], {
      cwd: directory,
      encoding: 'utf8',
      env: environment,
    })
    const notes = await readFile(join(directory, 'tmp/release/notes.md'), 'utf8').catch(() => '')
    const output = await readFile(outputs, 'utf8').catch(() => '')
    return { ...result, notes, output }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('release gate accepts an empty Unreleased section above the released version', async ({
  assert,
}) => {
  const result = await releaseCheck(
    '# Changelog\n\n## Unreleased\n\n## 9.9.9 - 2026-01-01\n\n- A\n'
  )
  assert.equal(result.status, 0, result.stderr)
  assert.include(result.stdout, 'ready: v9.9.9')
}).timeout(15_000)

test('release gate gives the release job its version and tarball name', async ({ assert }) => {
  const result = await releaseCheck('# Changelog\n\n## 9.9.9 - 2026-01-01\n\n- A\n')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.output, 'version=9.9.9\ntarball=release-fixture-9.9.9.tgz\n')
}).timeout(15_000)

test('release gate refuses entries under Unreleased, which the tarball would ship', async ({
  assert,
}) => {
  const result = await releaseCheck(
    '# Changelog\n\n## Unreleased\n\n- Later change\n\n## 9.9.9 - 2026-01-01\n\n- A\n'
  )
  assert.notEqual(result.status, 0)
  assert.include(result.stderr, "entries under '## Unreleased'")
}).timeout(15_000)

test('release gate matches the version heading literally', async ({ assert }) => {
  const result = await releaseCheck(
    '# Changelog\n\n## Unreleased\n\n## 9x9x9 - 2026-01-01\n\n- A\n'
  )
  assert.notEqual(result.status, 0)
  assert.include(result.stderr, "no '## 9.9.9 - YYYY-MM-DD' heading")
}).timeout(15_000)

test('release notes take only the exact version section', async ({ assert }) => {
  const result = await releaseCheck(
    '# Changelog\n\n## Unreleased\n\n## 9.9.9 - 2026-01-01\n\n- Current\n\n## 9a9a9 - 2025-01-01\n\n- Other\n'
  )
  assert.equal(result.status, 0, result.stderr)
  assert.include(result.notes, '- Current')
  assert.notInclude(result.notes, '- Other')
}).timeout(15_000)

test('release gate refuses a git-pinned Account Kit dev dependency', async ({ assert }) => {
  const changelog = '# Changelog\n\n## Unreleased\n\n## 9.9.9 - 2026-01-01\n\n- A\n'
  for (const pin of [
    'github:Kevinjohn/oss-adonisjs-account-kit#17e7a02b9abe408b8d2e78c9be9924bd8a0c36ce',
    'git+https://github.com/Kevinjohn/oss-adonisjs-account-kit.git#main',
    'https://codeload.github.com/Kevinjohn/oss-adonisjs-account-kit/tar.gz/17e7a02b',
  ]) {
    const result = await releaseCheck(changelog, {
      devDependencies: { '@kevinjohn/adonisjs-account-kit': pin },
    })
    assert.notEqual(result.status, 0, pin)
    assert.include(result.stderr, 'Account Kit dev dependency is a git pin')
  }
  const release = await releaseCheck(changelog, {
    devDependencies: {
      '@kevinjohn/adonisjs-account-kit':
        'https://github.com/Kevinjohn/oss-adonisjs-account-kit/releases/download/v0.3.0/kevinjohn-adonisjs-account-kit-0.3.0.tgz',
    },
  })
  assert.equal(release.status, 0, release.stderr)
}).timeout(30_000)
