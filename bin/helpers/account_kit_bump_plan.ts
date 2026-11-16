import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type KitRelease, rewriteFor } from './account_kit_bump.js'

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
    const rewrite = rewriteFor(path)
    if (!rewrite) continue
    const bytes = await readFile(join(root, path))
    if (bytes.includes(0)) continue
    const before = bytes.toString('utf8')
    const after = rewrite(before, from, to)
    if (after !== before)
      files.push({ path, before, after, beforeSha256: sha256(bytes), afterSha256: sha256(after) })
  }
  return { from, to, files }
}

export async function saveBumpPlan(root: string, plan: BumpPlan): Promise<void> {
  const path = join(root, planPath)
  await mkdir(join(root, 'tmp'), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, JSON.stringify(plan))
  await rename(temporary, path)
}

export async function applyBumpPlan(root: string, plan: BumpPlan): Promise<string[]> {
  const pending: BumpFile[] = []
  // Check every file before modifying any file. A concurrent edit to a planned file must be resolved by hand.
  for (const entry of plan.files) {
    const actual = sha256(await readFile(join(root, entry.path)))
    if (actual === entry.beforeSha256) pending.push(entry)
    else if (actual !== entry.afterSha256)
      throw new Error(`Planned file changed unexpectedly: ${entry.path}`)
  }
  for (const entry of pending) {
    // Repeat the check at the write boundary to catch changes made after validation.
    if (sha256(await readFile(join(root, entry.path))) !== entry.beforeSha256)
      throw new Error(`Planned file changed during bump: ${entry.path}`)
    await writeFile(join(root, entry.path), entry.after)
  }
  return pending.map((entry) => entry.path)
}
