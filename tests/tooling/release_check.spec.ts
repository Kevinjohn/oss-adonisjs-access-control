import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

async function optionalFile(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Run the release gate in a throwaway package with the given changelog; it builds and packs. */
async function releaseCheck(
  changelog: string,
  manifest: Record<string, unknown> = {},
  checksumCommand?: string
) {
  const directory = await mkdtemp(join(tmpdir(), 'access_control_release_check_'))
  try {
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name: 'release-fixture',
        version: '9.9.9',
        packageManager: 'pnpm@11.23.0',
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
    if (checksumCommand !== undefined) {
      const bin = join(directory, 'bin')
      await mkdir(bin)
      await writeFile(join(bin, 'shasum'), `#!/usr/bin/env bash\n${checksumCommand}\n`, {
        mode: 0o755,
      })
      environment.PATH = `${bin}:${environment.PATH}`
    }
    delete environment.GITHUB_ENV
    const result = spawnSync('bash', [join(repoRoot, 'bin/release_check.sh')], {
      cwd: directory,
      encoding: 'utf8',
      env: environment,
    })
    const notesFile = await optionalFile(join(directory, 'tmp/release/notes.md'))
    const outputFile = await optionalFile(outputs)
    const notes = notesFile?.toString() ?? ''
    const output = outputFile?.toString() ?? ''
    const archive = await optionalFile(join(directory, 'tmp/release/release-fixture-9.9.9.tgz'))
    const archiveDigest =
      archive === undefined ? undefined : createHash('sha256').update(archive).digest('hex')
    return { ...result, notes, output, archiveDigest }
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

const kitRelease = (version: string) =>
  `https://github.com/Kevinjohn/oss-adonisjs-account-kit/releases/download/v${version}/kevinjohn-adonisjs-account-kit-${version}.tgz`

test('release gate accepts only the release tarball of the declared Account Kit peer', async ({
  assert,
}) => {
  const changelog = '# Changelog\n\n## Unreleased\n\n## 9.9.9 - 2026-01-01\n\n- A\n'
  const peerDependencies = { '@kevinjohn/adonisjs-account-kit': '0.3.2' }
  for (const pin of [
    'github:Kevinjohn/oss-adonisjs-account-kit#17e7a02b9abe408b8d2e78c9be9924bd8a0c36ce',
    'Kevinjohn/oss-adonisjs-account-kit#17e7a02b9abe408b8d2e78c9be9924bd8a0c36ce',
    'git+https://github.com/Kevinjohn/oss-adonisjs-account-kit.git#main',
    'git://github.com/Kevinjohn/oss-adonisjs-account-kit.git#main',
    'https://codeload.github.com/Kevinjohn/oss-adonisjs-account-kit/tar.gz/17e7a02b',
    'https://github.com/Kevinjohn/oss-adonisjs-account-kit/archive/17e7a02b.tar.gz',
    'file:../oss-adonisjs-account-kit',
    'link:../oss-adonisjs-account-kit',
    kitRelease('0.3.0'),
    undefined,
  ]) {
    const result = await releaseCheck(changelog, {
      peerDependencies,
      ...(pin === undefined ? {} : { devDependencies: { '@kevinjohn/adonisjs-account-kit': pin } }),
    })
    assert.notEqual(result.status, 0, String(pin))
    assert.include(result.stderr, 'is not the v0.3.2 release tarball', String(pin))
  }
  const release = await releaseCheck(changelog, {
    peerDependencies,
    devDependencies: { '@kevinjohn/adonisjs-account-kit': kitRelease('0.3.2') },
  })
  assert.equal(release.status, 0, release.stderr)
}).timeout(60_000)

test('checksum failures never publish notes or successful ready outputs', async ({ assert }) => {
  for (const command of [
    "printf 'checksum read failed\\n' >&2; exit 7",
    'exit 0',
    "printf 'invalid-digest  archive.tgz\\n'",
    `printf '${'a'.repeat(63)}  archive.tgz\\n'`,
    `printf '${'g'.repeat(64)}  archive.tgz\\n'`,
    `printf '${'a'.repeat(64)}  archive.tgz\\n'; exit 7`,
  ]) {
    const result = await releaseCheck('# Changelog\n\n## 9.9.9 - 2026-01-01\n\n- A\n', {}, command)
    assert.notEqual(result.status, 0, command)
    assert.match(result.stderr, /SHA-256/, command)
    assert.equal(result.notes, '', command)
    assert.equal(result.output, '', command)
    assert.notInclude(result.stdout, 'ready:', command)
  }
}).timeout(60_000)

test('successful release notes carry the real archive digest', async ({ assert }) => {
  const result = await releaseCheck('# Changelog\n\n## 9.9.9 - 2026-01-01\n\n- A\n')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.archiveDigest!, /^[a-f0-9]{64}$/)
  assert.include(result.notes, `SHA-256: \`${result.archiveDigest}\``)
  assert.include(result.stdout, 'ready: v9.9.9')
  assert.equal(result.output, 'version=9.9.9\ntarball=release-fixture-9.9.9.tgz\n')
}).timeout(15_000)
