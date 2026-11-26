import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { type KitRelease } from './account_kit_bump.ts'
import { isKitBumpPath, projectKitFile } from './account_kit_bump_fields.ts'

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

interface PlannedFileSnapshot {
  bytes: Buffer
  dev: bigint
  ino: bigint
  mode: bigint
}

async function readPlannedFile(path: string): Promise<PlannedFileSnapshot> {
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  const handle = await open(path, flags)
  try {
    const metadata = await handle.stat({ bigint: true })
    const named = await lstat(path, { bigint: true })
    if (!metadata.isFile() || metadata.nlink !== 1n || !named.isFile() || named.nlink !== 1n) {
      throw new Error(`Planned path is not an independent regular file: ${path}`)
    }
    if (metadata.dev !== named.dev || metadata.ino !== named.ino) {
      throw new Error(`Planned path changed while opening: ${path}`)
    }
    return {
      bytes: await handle.readFile(),
      dev: metadata.dev,
      ino: metadata.ino,
      mode: metadata.mode,
    }
  } finally {
    await handle.close()
  }
}

function sameIdentity(left: PlannedFileSnapshot, right: PlannedFileSnapshot): boolean {
  return left.dev === right.dev && left.ino === right.ino
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
  let failure: unknown
  let ownsTemporary = false
  try {
    const handle = await open(temporary, 'wx', 0o600)
    ownsTemporary = true
    try {
      await handle.writeFile(JSON.stringify(plan))
    } catch (error) {
      failure = error
    }
    try {
      await handle.close()
    } catch (error) {
      failure =
        failure === undefined
          ? error
          : new AggregateError([failure, error], 'Plan write and close failed')
    }
    if (failure !== undefined) throw failure
    await link(temporary, path)
  } catch (error) {
    failure = error
  }
  if (ownsTemporary) {
    try {
      await rm(temporary, { force: true })
    } catch (cleanupError) {
      failure =
        failure === undefined
          ? cleanupError
          : new AggregateError([failure, cleanupError], 'Plan write and cleanup failed')
    }
  }
  if (failure !== undefined) throw failure
}

export async function applyBumpPlan(
  root: string,
  plan: BumpPlan,
  tracked?: Set<string>
): Promise<string[]> {
  const pending: Array<{ entry: BumpFile; snapshot: PlannedFileSnapshot }> = []
  const seen = new Set<string>()
  // Check every file before modifying any file. A concurrent edit to a planned file must be resolved by hand.
  for (const entry of plan.files) {
    if (seen.has(entry.path) || (tracked && !tracked.has(entry.path)) || !isKitBumpPath(entry.path))
      throw new Error(`Invalid planned path: ${entry.path}`)
    seen.add(entry.path)
    if (sha256(entry.before) !== entry.beforeSha256 || sha256(entry.after) !== entry.afterSha256)
      throw new Error(`Invalid planned contents: ${entry.path}`)
    const current = await readPlannedFile(join(root, entry.path))
    const actual = sha256(current.bytes)
    if (actual === entry.beforeSha256) pending.push({ entry, snapshot: current })
    else if (actual !== entry.afterSha256)
      throw new Error(`Planned file changed unexpectedly: ${entry.path}`)
  }
  for (const { entry, snapshot } of pending) {
    // Repeat the check at the write boundary to catch changes made after validation.
    const current = await readPlannedFile(join(root, entry.path))
    if (!sameIdentity(current, snapshot) || sha256(current.bytes) !== entry.beforeSha256)
      throw new Error(`Planned file changed during bump: ${entry.path}`)
    const destination = join(root, entry.path)
    const temporary = `${destination}.account-kit-${randomUUID()}.tmp`
    let failure: unknown
    let ownsTemporary = false
    try {
      const handle = await open(temporary, 'wx', Number(current.mode & 0o7777n))
      ownsTemporary = true
      try {
        await handle.writeFile(entry.after)
        await handle.chmod(Number(current.mode & 0o7777n))
      } catch (error) {
        failure = error
      }
      try {
        await handle.close()
      } catch (error) {
        failure =
          failure === undefined
            ? error
            : new AggregateError([failure, error], `Staging and close failed: ${entry.path}`)
      }
      if (failure !== undefined) throw failure
      const finalCheck = await readPlannedFile(destination)
      if (
        !sameIdentity(finalCheck, snapshot) ||
        finalCheck.mode !== snapshot.mode ||
        sha256(finalCheck.bytes) !== entry.beforeSha256
      )
        throw new Error(`Planned file changed during bump: ${entry.path}`)
      await rename(temporary, destination)
    } catch (error) {
      failure = error
    }
    if (ownsTemporary) {
      try {
        await rm(temporary, { force: true })
      } catch (cleanupError) {
        failure =
          failure === undefined
            ? cleanupError
            : new AggregateError(
                [failure, cleanupError],
                `Staging and cleanup failed: ${entry.path}`
              )
      }
    }
    if (failure !== undefined) throw failure
  }
  return pending.map(({ entry }) => entry.path)
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
