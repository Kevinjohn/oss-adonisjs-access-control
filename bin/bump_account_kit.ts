/**
 * Moves this repository to another Account Kit release: `pnpm bump:account-kit 0.3.5`.
 *
 * It downloads the current and target release tarballs, then rewrites every tracked reference:
 * release URLs and tarball names, the exact peer, lockfile integrity and versions, the release
 * SHA-256 and source commit, and version mentions in code and docs. `CHANGELOG.md` and the
 * requirement ledger's pin history stay as written; the script lists the lines that still name the
 * old version so they can be updated by hand.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  type KitRelease,
  kitPackage,
  kitReleaseUrl,
  kitRepository,
} from './helpers/account_kit_bump.js'
import {
  applyBumpPlan,
  makeBumpPlan,
  planPath,
  saveBumpPlan,
  type BumpPlan,
} from './helpers/account_kit_bump_plan.js'

const run = promisify(execFile)

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

async function fetchRelease(version: string): Promise<KitRelease> {
  const url = kitReleaseUrl(version)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Cannot download ${url}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())

  const refs = await git([
    'ls-remote',
    kitRepository,
    `refs/tags/v${version}`,
    `refs/tags/v${version}^{}`,
  ])
  const lines = refs.trim().split('\n').filter(Boolean)
  const line = lines.find((entry) => entry.endsWith('^{}')) ?? lines[0]
  if (!line) throw new Error(`Account Kit has no tag v${version}`)

  return {
    version,
    url,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    revision: line.split('\t')[0],
  }
}

const target = process.argv[2]
if (!target || !/^\d+\.\d+\.\d+$/.test(target)) {
  console.error('Usage: pnpm bump:account-kit <version>')
  process.exit(1)
}

const topLevel = await git(['rev-parse', '--show-toplevel'])
const root = topLevel.trim()
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const current: unknown = manifest.peerDependencies?.[kitPackage]
if (typeof current !== 'string' || !/^\d+\.\d+\.\d+$/.test(current))
  throw new Error(`package.json does not pin ${kitPackage} to an exact version.`)
if (manifest.version === current || manifest.version === target)
  throw new Error(
    `This package's own version ${manifest.version} matches an Account Kit version; rewrite by hand.`
  )

let plan: BumpPlan | undefined
try {
  plan = JSON.parse(await readFile(join(root, planPath), 'utf8')) as BumpPlan
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
if (plan && plan.to.version !== target)
  throw new Error(`An Account Kit bump to ${plan.to.version} is pending; finish it first.`)
if (!plan) {
  if (current === target) {
    // A root manifest alone cannot establish completion: inspect all tracked references.
    const trackedOutput = await git(['ls-files', '-z'], root)
    const tracked = trackedOutput.split('\0').filter(Boolean)
    const stale: string[] = []
    for (const path of tracked) {
      if (path === 'CHANGELOG.md' || path === 'docs/maintainers/requirement-ledger.md') continue
      const bytes = await readFile(join(root, path))
      if (bytes.includes(0)) continue
      const text = bytes.toString('utf8')
      const versions = [
        ...text.matchAll(
          /(?:oss-adonisjs-account-kit\/releases\/download\/v|kevinjohn-adonisjs-account-kit-)(\d+\.\d+\.\d+)/g
        ),
      ]
      if (versions.some((match) => match[1] !== target)) stale.push(path)
    }
    if (stale.length) throw new Error(`Account Kit references need review: ${stale.join(', ')}`)
    console.log(`Already on Account Kit ${target}.`)
    process.exit(0)
  }
  const [from, to] = await Promise.all([fetchRelease(current), fetchRelease(target)])
  const trackedOutput = await git(['ls-files', '-z'], root)
  const tracked = trackedOutput.split('\0').filter(Boolean)
  plan = await makeBumpPlan(root, tracked, from, to)
  await saveBumpPlan(root, plan)
}
const { from, to } = plan
const changed = await applyBumpPlan(root, plan)
console.log(`Account Kit ${from.version} -> ${to.version}`)
console.log(`  SHA-256  ${to.sha256}`)
console.log(`  commit   ${to.revision}`)
console.log(`Rewrote ${changed.length} files.`)

const oldVersion = `(^|[^0-9.])${from.version.replaceAll('.', '\\.')}([^0-9]|$)`
const leftovers = await git(
  [
    'grep',
    '-n',
    '-E',
    oldVersion,
    '--',
    '.',
    ':(exclude,glob)**/CHANGELOG.md',
    ':(exclude,glob)**/pnpm-lock.yaml',
  ],
  root
).catch((error: NodeJS.ErrnoException & { code?: number }) => {
  if (error.code === 1) return ''
  throw error
})
if (leftovers) {
  console.log(`\nStill naming ${from.version} (update by hand where it is not history):`)
  console.log(leftovers.trimEnd())
}
await rm(join(root, planPath))
console.log('\nAdd the changelog entry and any pin history notes, then run pnpm check.')
