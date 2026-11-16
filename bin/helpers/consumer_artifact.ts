import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export type PnpmCommand = (
  root: string,
  args: string[],
  signal: AbortSignal
) => Promise<void> | void
const runPnpm: PnpmCommand = (root, args, signal) =>
  new Promise<void>((done, reject) => {
    const child = spawn('pnpm', args, { cwd: root, stdio: 'inherit', signal })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) done()
      else reject(new Error(`pnpm ${args[0]} failed with exit ${code}`))
    })
  })

/** Owns one immutable input for the complete consumer run. Default build/pack is exclusive per checkout. */
export async function consumerArtifact(
  root: string,
  explicitPackage: string | undefined,
  pnpm: PnpmCommand = runPnpm
): Promise<{ path: string; cleanup: () => void }> {
  const privateDir = mkdtempSync(join(tmpdir(), 'access_control_archive_'))
  const lock = join(root, 'tmp', 'consumer-build.lock')
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() })
  let ownsLock = false
  const controller = new AbortController()
  let interrupted: 'SIGINT' | 'SIGTERM' | undefined
  const releaseLock = () => {
    if (!ownsLock) return
    if (readFileSync(lock, 'utf8') !== owner)
      throw new Error(`Consumer build lock ownership changed: ${lock}`)
    rmSync(lock)
    ownsLock = false
  }
  const onInt = () => {
    interrupted = 'SIGINT'
    controller.abort()
  }
  const onTerm = () => {
    interrupted = 'SIGTERM'
    controller.abort()
  }
  try {
    let source: string
    if (explicitPackage === undefined) {
      mkdirSync(join(root, 'tmp'), { recursive: true })
      let fd: number
      try {
        fd = openSync(lock, 'wx')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const existing = readFileSync(lock, 'utf8')
          throw new Error(
            `Default consumer build lock exists at ${lock}: ${existing || 'owner not recorded'}. Inspect the owner before removing a stale lock.`
          )
        }
        throw error
      }
      try {
        writeFileSync(fd, owner)
      } catch (error) {
        rmSync(lock)
        throw error
      } finally {
        closeSync(fd)
      }
      ownsLock = true
      process.on('SIGINT', onInt)
      process.on('SIGTERM', onTerm)
      await pnpm(root, ['build'], controller.signal)
      if (interrupted) throw new Error(`Consumer build interrupted by ${interrupted}`)
      source = join(privateDir, `packed_${randomUUID()}.tgz`)
      await pnpm(root, ['pack', '--out', source], controller.signal)
      if (interrupted) throw new Error(`Consumer pack interrupted by ${interrupted}`)
    } else source = resolve(root, explicitPackage)
    const path = join(privateDir, 'package.tgz')
    copyFileSync(source, path)
    releaseLock()
    return { path, cleanup: () => rmSync(privateDir, { recursive: true, force: true }) }
  } catch (error) {
    try {
      releaseLock()
      rmSync(privateDir, { recursive: true, force: true })
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Consumer archive creation and cleanup failed'
      )
    }
    if (interrupted) process.exit(interrupted === 'SIGINT' ? 130 : 143)
    throw error
  } finally {
    process.removeListener('SIGINT', onInt)
    process.removeListener('SIGTERM', onTerm)
  }
}
