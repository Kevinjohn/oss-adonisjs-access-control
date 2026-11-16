import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, openSync, closeSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export type PnpmCommand = (root: string, args: string[]) => void
const runPnpm: PnpmCommand = (root, args) => {
  execFileSync('pnpm', args, { cwd: root, stdio: 'inherit' })
}

/** Owns one immutable input for the complete consumer run. Default build/pack is exclusive per checkout. */
export function consumerArtifact(
  root: string,
  explicitPackage: string | undefined,
  pnpm: PnpmCommand = runPnpm
): { path: string; cleanup: () => void } {
  const privateDir = mkdtempSync(join(tmpdir(), 'access_control_archive_'))
  const lock = join(root, 'tmp', 'consumer-build.lock')
  let ownsLock = false
  try {
    let source: string
    if (explicitPackage === undefined) {
      mkdirSync(join(root, 'tmp'), { recursive: true })
      try {
        closeSync(openSync(lock, 'wx'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new Error('Another default consumer build is active in this checkout')
        throw error
      }
      ownsLock = true
      pnpm(root, ['build'])
      source = join(privateDir, `packed_${randomUUID()}.tgz`)
      pnpm(root, ['pack', '--out', source])
    } else source = resolve(root, explicitPackage)
    const path = join(privateDir, 'package.tgz')
    copyFileSync(source, path)
    return {
      path,
      cleanup: () => {
        rmSync(privateDir, { recursive: true, force: true })
        if (ownsLock) rmSync(lock, { force: true })
      },
    }
  } catch (error) {
    rmSync(privateDir, { recursive: true, force: true })
    if (ownsLock) rmSync(lock, { force: true })
    throw error
  }
}
