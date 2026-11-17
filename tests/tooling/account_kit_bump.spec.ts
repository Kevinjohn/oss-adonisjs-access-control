import { test } from '@japa/runner'
import { type KitRelease, kitReleaseUrl } from '../../bin/helpers/account_kit_bump.js'
import { isKitBumpPath, projectKitFile } from '../../bin/helpers/account_kit_bump_fields.js'

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

test.group('Account Kit owned fields', () => {
  test('rewrites lockfile Kit resolution and peer while preserving unrelated values', ({
    assert,
  }) => {
    const lock = `importers:\n  .:\n    devDependencies:\n      '@kevinjohn/adonisjs-account-kit':\n        specifier: ${from.url}\n        version: ${from.url}(context)\npackages:\n  '@kevinjohn/adonisjs-account-kit@${from.url}':\n    resolution: {integrity: ${from.integrity}, tarball: ${from.url}}\n    version: ${from.version}\n  '@kevinjohn/adonisjs-access-control@0.1.8':\n    peerDependencies:\n      '@kevinjohn/adonisjs-account-kit': ${from.version}\n  'youch-core@0.3.3':\n    resolution: {integrity: sha512-KEEP==}\nsnapshots:\n  '@kevinjohn/adonisjs-account-kit@${from.url}(context)':\n    dependencies: {}\n`
    const rewritten = projectKitFile('examples/consumer/pnpm-lock.yaml', lock, from, to)
    assert.notInclude(rewritten, from.url)
    assert.include(rewritten, to.integrity)
    assert.include(rewritten, `version: ${to.version}`)
    assert.include(rewritten, `'@kevinjohn/adonisjs-account-kit': ${to.version}`)
    assert.include(rewritten, "'youch-core@0.3.3':")
    assert.throws(
      () =>
        projectKitFile(
          'examples/consumer/pnpm-lock.yaml',
          lock.replace(from.integrity, 'sha512-BAD=='),
          from,
          to
        ),
      /package integrity/
    )
  })

  test('rewrites only exact Kit manifest entries', ({ assert }) => {
    const manifest = JSON.stringify(
      {
        version: '0.1.8',
        devDependencies: { '@kevinjohn/adonisjs-account-kit': from.url, 'other': '0.3.3' },
        peerDependencies: { '@kevinjohn/adonisjs-account-kit': from.version },
      },
      null,
      2
    )
    const result = JSON.parse(projectKitFile('package.json', manifest, from, to))
    assert.equal(result.devDependencies['@kevinjohn/adonisjs-account-kit'], to.url)
    assert.equal(result.peerDependencies['@kevinjohn/adonisjs-account-kit'], to.version)
    assert.equal(result.devDependencies.other, '0.3.3')
  })

  test('preserves history and excludes retired app readmes', ({ assert }) => {
    assert.isFalse(isKitBumpPath('examples/foo/CHANGELOG.md'))
    assert.equal(projectKitFile('examples/foo/CHANGELOG.md', from.url, from, to), from.url)
    assert.isFalse(isKitBumpPath('examples/with_account_kit/api/README.md'))
    assert.equal(
      projectKitFile(
        'examples/with_account_kit/api/README.md',
        `Account Kit ${from.version}`,
        from,
        to
      ),
      `Account Kit ${from.version}`
    )
    const ledger = `**Matrix status:** Kit ${from.version} and ${from.version}\nHistory ${from.version}`
    assert.equal(
      projectKitFile('docs/maintainers/requirement-ledger.md', ledger, from, to),
      `**Matrix status:** Kit ${to.version} and ${to.version}\nHistory ${to.version}`
    )
    const history = `**Matrix status:** Kit ${from.version}\n\nHistory ${from.version}`
    assert.equal(
      projectKitFile('docs/maintainers/requirement-ledger.md', history, from, to),
      `**Matrix status:** Kit ${to.version}\n\nHistory ${from.version}`
    )
  })

  test('keeps deliberately stale installed fixture and unrelated hashes', ({ assert }) => {
    const source = `assert.equal(versions.expected, '${from.version}')\nassert.equal(versions.installed, '${from.version}')\n{ installed: '0.3.2', expected: '${from.version}' }\nconst hash = '${from.sha256}'`
    const prefixed = `const versions = accountKitVersions()\n${source}`
    const rewritten = projectKitFile('tests/doctor.spec.ts', prefixed, from, to)
    assert.include(rewritten, "installed: '0.3.2'")
    assert.include(rewritten, `const hash = '${from.sha256}'`)
    assert.include(rewritten, `versions.expected, '${to.version}'`)
  })
})

test.group('Account Kit bump plan', () => {
  test('resumes a partial rewrite while the root manifest is already at target', async ({
    assert,
  }) => {
    const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { applyBumpPlan, makeBumpPlan } =
      await import('../../bin/helpers/account_kit_bump_plan.js')
    const root = await mkdtemp(join(tmpdir(), 'kit_bump_test_'))
    const paths = ['package.json', 'README.md']
    try {
      await writeFile(
        join(root, paths[0]),
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
      await writeFile(join(root, paths[1]), `Account Kit ${from.version}`)
      const plan = await makeBumpPlan(root, paths, from, to)
      await writeFile(join(root, paths[0]), plan.files[0].after)
      assert.deepEqual(await applyBumpPlan(root, plan), ['README.md'])
      assert.include(await readFile(join(root, paths[1]), 'utf8'), to.version)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses unrelated edits to a planned file before further writes', async ({ assert }) => {
    const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { applyBumpPlan, makeBumpPlan } =
      await import('../../bin/helpers/account_kit_bump_plan.js')
    const root = await mkdtemp(join(tmpdir(), 'kit_bump_test_'))
    try {
      await writeFile(join(root, 'README.md'), `Account Kit ${from.version}`)
      await writeFile(join(root, 'README-AGENTS.md'), `Account Kit ${from.version}`)
      const plan = await makeBumpPlan(root, ['README.md', 'README-AGENTS.md'], from, to)
      await writeFile(join(root, 'README-AGENTS.md'), 'user edit')
      await assert.rejects(() => applyBumpPlan(root, plan), /changed unexpectedly/)
      assert.include(await readFile(join(root, 'README.md'), 'utf8'), from.version)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
