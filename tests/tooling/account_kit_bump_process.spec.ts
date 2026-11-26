import { test } from '@japa/runner'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { makeBumpPlan, saveBumpPlan } from '../../bin/helpers/account_kit_bump_plan.ts'
import { kitReleaseUrl, type KitRelease } from '../../bin/helpers/account_kit_bump.ts'

const run = promisify(execFile)
const script = fileURLToPath(new URL('../../bin/bump_account_kit.ts', import.meta.url))
const loader = fileURLToPath(import.meta.resolve('@poppinss/ts-exec'))
const from: KitRelease = {
  version: '0.3.3',
  url: kitReleaseUrl('0.3.3'),
  integrity: 'sha512-OLD==',
  sha256: 'a'.repeat(64),
  revision: 'b'.repeat(40),
}
const to: KitRelease = {
  version: '0.3.4',
  url: kitReleaseUrl('0.3.4'),
  integrity: 'sha512-NEW==',
  sha256: 'c'.repeat(64),
  revision: 'd'.repeat(40),
}

async function writeLock(root: string): Promise<void> {
  await writeFile(
    join(root, 'pnpm-lock.yaml'),
    `importers:\n  .:\n    devDependencies:\n      '@kevinjohn/adonisjs-account-kit':\n        specifier: ${from.url}\n        version: ${from.url}(context)\npackages:\n  '@kevinjohn/adonisjs-account-kit@${from.url}':\n    resolution: {integrity: ${from.integrity}, tarball: ${from.url}}\n    version: ${from.version}\n`
  )
}
test('bump command finishes a journaled partial write after manifest reached target', async ({
  assert,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'kit_bump_process_'))
  try {
    await run('git', ['init', '-q', root])
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify(
        {
          version: '0.1.8',
          peerDependencies: { '@kevinjohn/adonisjs-account-kit': from.version },
          devDependencies: { '@kevinjohn/adonisjs-account-kit': from.url },
        },
        null,
        2
      )
    )
    await writeFile(join(root, 'README.md'), `Account Kit ${from.version}\n`)
    await writeLock(root)
    await run('git', ['add', 'package.json', 'README.md', 'pnpm-lock.yaml'], { cwd: root })
    const plan = await makeBumpPlan(root, ['package.json', 'README.md', 'pnpm-lock.yaml'], from, to)
    await saveBumpPlan(root, plan)
    await writeFile(join(root, 'package.json'), plan.files[0].after)
    const result = await run(process.execPath, ['--import', loader, script, to.version], {
      cwd: root,
    })
    assert.include(result.stdout, 'Rewrote 2 files.')
    assert.include(await readFile(join(root, 'README.md'), 'utf8'), to.version)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bump command preserves a failed leftover scan', async ({ assert }) => {
  const { mkdir, chmod } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'kit_bump_scan_'))
  try {
    await run('git', ['init', '-q', root])
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify(
        {
          version: '0.1.8',
          peerDependencies: { '@kevinjohn/adonisjs-account-kit': from.version },
          devDependencies: { '@kevinjohn/adonisjs-account-kit': from.url },
        },
        null,
        2
      )
    )
    await writeLock(root)
    await run('git', ['add', 'package.json', 'pnpm-lock.yaml'], { cwd: root })
    const plan = await makeBumpPlan(root, ['package.json', 'pnpm-lock.yaml'], from, to)
    await saveBumpPlan(root, plan)
    const shim = join(root, 'shim')
    await mkdir(shim)
    await writeFile(
      join(shim, 'git'),
      '#!/bin/sh\nif [ "$1" = grep ]; then exit 128; fi\nexec /usr/bin/git "$@"\n'
    )
    await chmod(join(shim, 'git'), 0o755)
    let failure: { stderr?: string; stdout?: string } | undefined
    try {
      await run(process.execPath, ['--import', loader, script, to.version], {
        cwd: root,
        env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
      })
    } catch (error) {
      failure = error as typeof failure
    }
    assert.match(failure?.stderr ?? '', /git grep/)
    assert.notInclude(failure?.stdout ?? '', 'Add the changelog entry')
    assert.include(await readFile(join(root, 'package.json'), 'utf8'), to.version)
    assert.ok(await readFile(join(root, 'tmp/account-kit-bump-plan.json'), 'utf8'))
    const retry = await run(process.execPath, ['--import', loader, script, to.version], {
      cwd: root,
    })
    assert.include(retry.stdout, 'Account Kit 0.3.3 -> 0.3.4')
    await assert.rejects(() => readFile(join(root, 'tmp/account-kit-bump-plan.json')), /ENOENT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
