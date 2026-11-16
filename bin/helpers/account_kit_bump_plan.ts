import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { type KitRelease } from './account_kit_bump.js'
import { isKitBumpPath, projectKitFile } from './account_kit_bump_fields.js'

export interface BumpFile {
  path: string
  before: string
  after: string
  beforeSha256: string
  afterSha256: string
}

export interface BumpPlan {
  from: KitRelease
  to: KitRelease
  files: BumpFile[]
}

export const planPath = 'tmp/account-kit-bump-plan.json'

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function makeBumpPlan(
  root: string,
  paths: string[],
  from: KitRelease,
  to: KitRelease
): Promise<BumpPlan> {
  const files: BumpFile[] = []
  for (const path of paths) {
    if (path.split('/').pop() === 'CHANGELOG.md') continue
    const bytes = await readFile(join(root, path))
    if (bytes.includes(0)) continue
    const before = bytes.toString('utf8')
    const after = projectKitFile(path, before, from, to)
    if (after !== before)
      files.push({ path, before, after, beforeSha256: sha256(bytes), afterSha256: sha256(after) })
  }
  return { from, to, files }
}

export async function saveBumpPlan(root: string, plan: BumpPlan): Promise<void> {
  const path = join(root, planPath)
  await mkdir(join(root, 'tmp'), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(plan))
  } finally {
    await handle.close()
  }
  try {
    await link(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function applyBumpPlan(
  root: string,
  plan: BumpPlan,
  tracked?: Set<string>
): Promise<string[]> {
  const pending: BumpFile[] = []
  const seen = new Set<string>()
  // Check every file before modifying any file. A concurrent edit to a planned file must be resolved by hand.
  for (const entry of plan.files) {
    if (seen.has(entry.path) || (tracked && !tracked.has(entry.path)) || !isKitBumpPath(entry.path))
      throw new Error(`Invalid planned path: ${entry.path}`)
    seen.add(entry.path)
    if (sha256(entry.before) !== entry.beforeSha256 || sha256(entry.after) !== entry.afterSha256)
      throw new Error(`Invalid planned contents: ${entry.path}`)
    const metadata = await lstat(join(root, entry.path))
    if (!metadata.isFile() || metadata.nlink !== 1)
      throw new Error(`Planned path is not an independent regular file: ${entry.path}`)
    const actual = sha256(await readFile(join(root, entry.path)))
    if (actual === entry.beforeSha256) pending.push(entry)
    else if (actual !== entry.afterSha256)
      throw new Error(`Planned file changed unexpectedly: ${entry.path}`)
  }
  for (const entry of pending) {
    // Repeat the check at the write boundary to catch changes made after validation.
    if (sha256(await readFile(join(root, entry.path))) !== entry.beforeSha256)
      throw new Error(`Planned file changed during bump: ${entry.path}`)
    const destination = join(root, entry.path)
    const metadata = await lstat(destination)
    if (!metadata.isFile() || metadata.nlink !== 1)
      throw new Error(`Planned path changed type: ${entry.path}`)
    const temporary = `${destination}.account-kit-${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', metadata.mode & 0o777)
    try {
      await handle.writeFile(entry.after)
      await handle.chmod(metadata.mode & 0o777)
    } finally {
      await handle.close()
    }
    try {
      if (sha256(await readFile(destination)) !== entry.beforeSha256)
        throw new Error(`Planned file changed during bump: ${entry.path}`)
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  return pending.map((entry) => entry.path)
}

export async function verifyBumpCheckout(
  root: string,
  paths: string[],
  plan: BumpPlan
): Promise<void> {
  const expected = new Map(plan.files.map((entry) => [entry.path, entry.afterSha256]))
  for (const path of paths) {
    if (path.split('/').pop() === 'CHANGELOG.md') continue
    const bytes = await readFile(join(root, path))
    if (bytes.includes(0)) continue
    const text = bytes.toString('utf8')
    projectKitFile(path, text, plan.to, plan.to)
    if (expected.has(path) && sha256(bytes) !== expected.get(path))
      throw new Error(`Planned target content changed: ${path}`)
  }
}
