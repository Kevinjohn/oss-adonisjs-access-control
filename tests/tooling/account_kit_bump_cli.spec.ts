import { test } from '@japa/runner'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { kitReleaseUrl } from '../../bin/helpers/account_kit_bump.js'

const run = promisify(execFile)
const script = fileURLToPath(new URL('../../bin/bump_account_kit.ts', import.meta.url))
const loader = fileURLToPath(import.meta.resolve('@poppinss/ts-exec'))
const releases = {
  '0.3.3': Buffer.from('source archive'),
  '0.3.4': Buffer.from('target archive'),
}
const fact = (version: '0.3.3' | '0.3.4') => ({
  version,
  url: kitReleaseUrl(version),
  integrity: `sha512-${createHash('sha512').update(releases[version]).digest('base64')}`,
  sha256: createHash('sha256').update(releases[version]).digest('hex'),
  revision: version === '0.3.3' ? 'a'.repeat(40) : 'b'.repeat(40),
})

type Fixture = Awaited<ReturnType<typeof fixture>>
async function fixture(version: '0.3.3' | '0.3.4') {
  const root = await mkdtemp(join(tmpdir(), 'kit_cli_test_'))
  const kit = fact(version)
  const manifest =
    JSON.stringify(
      {
        version: '0.1.8',
        devDependencies: { '@kevinjohn/adonisjs-account-kit': kit.url },
        peerDependencies: { '@kevinjohn/adonisjs-account-kit': version },
      },
      null,
      2
    ) + '\n'
  const lock = `importers:\n  .:\n    devDependencies:\n      '@kevinjohn/adonisjs-account-kit':\n        specifier: ${kit.url}\n        version: ${kit.url}(context)\npackages:\n  '@kevinjohn/adonisjs-account-kit@${kit.url}':\n    resolution: {integrity: ${kit.integrity}, tarball: ${kit.url}}\n    version: ${version}\nsnapshots:\n  '@kevinjohn/adonisjs-account-kit@${kit.url}(context)':\n    dependencies: {}\n`
  const files = {
    'package.json': manifest,
    'pnpm-lock.yaml': lock,
    'README.md': `Account Kit ${version} (exact).\n`,
    'CHANGELOG.md': `Historical Account Kit ${version} at ${kit.url}\n`,
    'docs/maintainers/requirement-ledger.md': `**Matrix status:** Kit ${version}\n\nHistory Kit 0.3.3\n`,
    'examples/demo/CHANGELOG.md': `Historical ${kit.url}\n`,
    'examples/with_account_kit/api/README.md':
      `[API example](https://github.com/Kevinjohn/oss-adonisjs-account-kit/tree/v${version}/examples/api)\nat ` +
      '`v' +
      version +
      '`, with Access Control.\n`v' +
      version +
      '` GitHub release.\n',
    'tests/doctor.spec.ts': `const versions = accountKitVersions()\nassert.equal(versions.expected, '${version}')\nassert.equal(versions.installed, '${version}')\n{ installed: '0.3.2', expected: '${version}' }\n`,
    'src/kit_provenance.ts': `export const kitReleaseVersion = '${version}'\nexport const kitReleaseSha256 = '${kit.sha256}'\nexport const kitSourceRevision = '${kit.revision}'\n`,
  }
  await run('git', ['init', '-q', root])
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), body)
  }
  await run('git', ['add', ...Object.keys(files)], { cwd: root })
  const shim = join(root, 'shim')
  await mkdir(shim)
  await writeFile(
    join(shim, 'git'),
    `#!/bin/sh\nif [ "$1" = ls-remote ]; then\n  if [ "$KIT_OFFLINE" = 1 ]; then exit 89; fi\n  case "$*" in *0.3.3*) printf '${'a'.repeat(40)}\\trefs/tags/v0.3.3\\n';; *0.3.4*) printf '${'b'.repeat(40)}\\trefs/tags/v0.3.4\\n';; esac\n  exit 0\nfi\nexec /usr/bin/git "$@"\n`
  )
  await chmod(join(shim, 'git'), 0o755)
  const preload = join(root, 'preload.cjs')
  await writeFile(
    preload,
    `globalThis.fetch = async (url) => { if (process.env.KIT_FETCH_FAIL === '1') throw new Error('fixture download failed'); return ({ ok: true, arrayBuffer: async () => Uint8Array.from(Buffer.from(url.includes('v0.3.4') ? ${JSON.stringify([...releases['0.3.4']])} : ${JSON.stringify([...releases['0.3.3']])})).buffer }) }`
  )
  const env = { ...process.env, PATH: `${shim}:${process.env.PATH}` }
  const invoke = (extra: string[] = [], overrides: NodeJS.ProcessEnv = {}) =>
    run(process.execPath, ['--import', loader, '--require', preload, ...extra, script, '0.3.4'], {
      cwd: root,
      env: { ...env, ...overrides },
    })
  return { root, files, env, invoke }
}

async function discard(setup: Fixture) {
  await rm(setup.root, { recursive: true, force: true })
}

test('same-target command rejects each stale owned field without writing', async ({ assert }) => {
  const target = fact('0.3.4')
  const source = fact('0.3.3')
  const cases: Array<[string, string, string, string]> = [
    ['package.json', target.url, source.url, 'devDependencies'],
    ['pnpm-lock.yaml', target.integrity, source.integrity, 'integrity'],
    [
      'pnpm-lock.yaml',
      `version: ${target.version}`,
      `version: ${source.version}`,
      'resolved version',
    ],
    ['README.md', target.version, source.version, 'live Account Kit version'],
    [
      'docs/maintainers/requirement-ledger.md',
      `Kit ${target.version}`,
      `Kit ${source.version}`,
      'matrix version',
    ],
    ['src/kit_provenance.ts', target.sha256, source.sha256, 'kitReleaseSha256'],
    ['src/kit_provenance.ts', target.revision, source.revision, 'kitSourceRevision'],
    [
      'tests/doctor.spec.ts',
      `expected: '${target.version}'`,
      `expected: '${source.version}'`,
      'doctor expected',
    ],
  ]
  for (const [path, before, after, field] of cases) {
    const setup = await fixture('0.3.4')
    try {
      const changed = setup.files[path as keyof typeof setup.files].replace(before, after)
      await writeFile(join(setup.root, path), changed)
      let failure: { stderr?: string; stdout?: string } | undefined
      try {
        await setup.invoke()
      } catch (error) {
        failure = error as typeof failure
      }
      assert.isDefined(failure)
      assert.match(failure?.stderr ?? '', new RegExp(`${path}.*${field}`))
      assert.notInclude(failure?.stdout ?? '', 'Already on Account Kit')
      assert.equal(await readFile(join(setup.root, path), 'utf8'), changed)
      await assert.rejects(
        () => readFile(join(setup.root, 'tmp/account-kit-bump-plan.json')),
        /ENOENT/
      )
    } finally {
      await discard(setup)
    }
  }
})

test('same-target command accepts live fields with historical changelog content', async ({
  assert,
}) => {
  const setup = await fixture('0.3.4')
  try {
    const result = await setup.invoke()
    assert.include(result.stdout, 'Already on Account Kit 0.3.4.')
    assert.equal(
      await readFile(join(setup.root, 'CHANGELOG.md'), 'utf8'),
      setup.files['CHANGELOG.md']
    )
  } finally {
    await discard(setup)
  }
})

test('fresh command creates a verified plan and rewrites live fields', async ({ assert }) => {
  const setup = await fixture('0.3.3')
  try {
    const result = await setup.invoke()
    assert.include(result.stdout, 'Account Kit 0.3.3 -> 0.3.4')
    assert.include(
      await readFile(join(setup.root, 'pnpm-lock.yaml'), 'utf8'),
      fact('0.3.4').integrity
    )
    assert.equal(
      await readFile(join(setup.root, 'CHANGELOG.md'), 'utf8'),
      setup.files['CHANGELOG.md']
    )
    await assert.rejects(
      () => readFile(join(setup.root, 'tmp/account-kit-bump-plan.json')),
      /ENOENT/
    )
  } finally {
    await discard(setup)
  }
})

test('fresh bump resumes after interruption during a sibling file write', async ({ assert }) => {
  const { stat } = await import('node:fs/promises')
  const setup = await fixture('0.3.3')
  try {
    await chmod(join(setup.root, 'README.md'), 0o755)
    const fault = join(setup.root, 'fault.cjs')
    await writeFile(
      fault,
      `const fs = require('node:fs/promises'); const mod = require('node:module'); const original = fs.open; fs.open = async (...args) => { const handle = await original(...args); if (String(args[0]).includes('package.json.account-kit-')) { const write = handle.writeFile.bind(handle); handle.writeFile = async (value) => { await write(String(value).slice(0, 9)); process.exit(73) } } return handle }; mod.syncBuiltinESMExports();`
    )
    let failure: { code?: number; stdout?: string } | undefined
    try {
      await setup.invoke(['--require', fault])
    } catch (error) {
      failure = error as typeof failure
    }
    assert.equal(failure?.code, 73)
    assert.notInclude(failure?.stdout ?? '', 'Add the changelog entry')
    assert.include(await readFile(join(setup.root, 'README.md'), 'utf8'), '0.3.4')
    assert.equal(
      await readFile(join(setup.root, 'package.json'), 'utf8'),
      setup.files['package.json']
    )
    assert.equal(
      await readFile(join(setup.root, 'pnpm-lock.yaml'), 'utf8'),
      setup.files['pnpm-lock.yaml']
    )
    assert.ok(await readFile(join(setup.root, 'tmp/account-kit-bump-plan.json'), 'utf8'))
    const resumed = await setup.invoke([], { KIT_OFFLINE: '1' })
    assert.include(resumed.stdout, 'Account Kit 0.3.3 -> 0.3.4')
    assert.include(await readFile(join(setup.root, 'package.json'), 'utf8'), fact('0.3.4').url)
    assert.include(
      await readFile(join(setup.root, 'pnpm-lock.yaml'), 'utf8'),
      fact('0.3.4').integrity
    )
    const readmeStat = await stat(join(setup.root, 'README.md'))
    assert.equal(readmeStat.mode & 0o777, 0o755)
    await assert.rejects(
      () => readFile(join(setup.root, 'tmp/account-kit-bump-plan.json')),
      /ENOENT/
    )
  } finally {
    await discard(setup)
  }
})

test('restart verifies a completed final rename before clearing the plan', async ({ assert }) => {
  const setup = await fixture('0.3.3')
  try {
    const fault = join(setup.root, 'after_rename.cjs')
    await writeFile(
      fault,
      `const fs = require('node:fs/promises'); const mod = require('node:module'); const original = fs.rename; fs.rename = async (...args) => { await original(...args); if (String(args[0]).includes('pnpm-lock.yaml.account-kit-')) process.exit(74) }; mod.syncBuiltinESMExports();`
    )
    let failure: { code?: number; stdout?: string } | undefined
    try {
      await setup.invoke(['--require', fault])
    } catch (error) {
      failure = error as typeof failure
    }
    assert.equal(failure?.code, 74)
    assert.include(
      await readFile(join(setup.root, 'pnpm-lock.yaml'), 'utf8'),
      fact('0.3.4').integrity
    )
    assert.ok(await readFile(join(setup.root, 'tmp/account-kit-bump-plan.json'), 'utf8'))
    const resumed = await setup.invoke([], { KIT_OFFLINE: '1' })
    assert.include(resumed.stdout, 'Account Kit 0.3.3 -> 0.3.4')
    await assert.rejects(
      () => readFile(join(setup.root, 'tmp/account-kit-bump-plan.json')),
      /ENOENT/
    )
  } finally {
    await discard(setup)
  }
})

test('same-target download failure and removed tracked file never report completion', async ({
  assert,
}) => {
  const setup = await fixture('0.3.4')
  try {
    for (const overrides of [{ KIT_FETCH_FAIL: '1' }, {}]) {
      if (!overrides.KIT_FETCH_FAIL) await rm(join(setup.root, 'README.md'))
      let failure: { stderr?: string; stdout?: string } | undefined
      try {
        await setup.invoke([], overrides)
      } catch (error) {
        failure = error as typeof failure
      }
      assert.isDefined(failure)
      assert.notInclude(failure?.stdout ?? '', 'Already on Account Kit')
      assert.match(
        failure?.stderr ?? '',
        overrides.KIT_FETCH_FAIL ? /fixture download failed/ : /ENOENT/
      )
    }
  } finally {
    await discard(setup)
  }
})

test('resume refuses a hand edit to a later planned file and preserves an unplanned edit', async ({
  assert,
}) => {
  const setup = await fixture('0.3.3')
  try {
    const fault = join(setup.root, 'fault.cjs')
    await writeFile(
      fault,
      `const fs = require('node:fs/promises'); const mod = require('node:module'); const original = fs.open; fs.open = async (...args) => { const handle = await original(...args); if (String(args[0]).includes('package.json.account-kit-')) { const write = handle.writeFile.bind(handle); handle.writeFile = async (value) => { await write(String(value).slice(0, 9)); process.exit(73) } } return handle }; mod.syncBuiltinESMExports();`
    )
    try {
      await setup.invoke(['--require', fault])
    } catch {
      /* staged interruption */
    }
    const edited = setup.files['pnpm-lock.yaml'] + '# user edit\n'
    await writeFile(join(setup.root, 'pnpm-lock.yaml'), edited)
    await writeFile(join(setup.root, 'CHANGELOG.md'), 'Unplanned edit\n')
    let failure: { stderr?: string } | undefined
    try {
      await setup.invoke([], { KIT_OFFLINE: '1' })
    } catch (error) {
      failure = error as typeof failure
    }
    assert.match(failure?.stderr ?? '', /Planned file changed unexpectedly: pnpm-lock.yaml/)
    assert.equal(await readFile(join(setup.root, 'pnpm-lock.yaml'), 'utf8'), edited)
    assert.equal(
      await readFile(join(setup.root, 'package.json'), 'utf8'),
      setup.files['package.json']
    )
    assert.equal(await readFile(join(setup.root, 'CHANGELOG.md'), 'utf8'), 'Unplanned edit\n')
    assert.ok(await readFile(join(setup.root, 'tmp/account-kit-bump-plan.json'), 'utf8'))
    await writeFile(join(setup.root, 'pnpm-lock.yaml'), setup.files['pnpm-lock.yaml'])
    await setup.invoke([], { KIT_OFFLINE: '1' })
    assert.equal(await readFile(join(setup.root, 'CHANGELOG.md'), 'utf8'), 'Unplanned edit\n')
  } finally {
    await discard(setup)
  }
})
