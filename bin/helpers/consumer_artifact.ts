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
import type { ConsumerProcessRunner } from './consumer_process.js'

/** Owns one immutable input for the complete consumer run. Default build/pack is exclusive per checkout. */
export async function consumerArtifact(
  root: string,
  explicitPackage: string | undefined,
  runner: Pick<ConsumerProcessRunner, 'run' | 'unconfirmedProducer'>
): Promise<{ path: string; cleanup: () => void }> {
  const privateDir = mkdtempSync(join(tmpdir(), 'access_control_archive_'))
  const lock = join(root, 'tmp', 'consumer-build.lock')
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() })
  let ownsLock = false
  const releaseLock = () => {
    if (!ownsLock) return
    if (readFileSync(lock, 'utf8') !== owner)
      throw new Error(`Consumer build lock ownership changed: ${lock}`)
    rmSync(lock)
    ownsLock = false
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
      await runner.run(root, ['build'], 'archive_build', process.env)
      source = join(privateDir, `packed_${randomUUID()}.tgz`)
      await runner.run(root, ['pack', '--out', source], 'archive_pack', process.env)
    } else source = resolve(root, explicitPackage)
    const path = join(privateDir, 'package.tgz')
    copyFileSync(source, path)
    releaseLock()
    return { path, cleanup: () => rmSync(privateDir, { recursive: true, force: true }) }
  } catch (error) {
    const producer = runner.unconfirmedProducer
    if (ownsLock && producer) {
      // A still-running producer may continue writing shared build output or its private archive.
      throw new AggregateError(
        [
          error,
          new Error(
            `Consumer producer ${producer.name} (process group ${producer.pid}) could not be confirmed stopped. Retained ${lock} with owner ${owner} and ${privateDir}. Inspect the producer, establish quiescence, then re-check lock ownership before removing it.`
          ),
        ],
        'Consumer archive preparation stopped without producer quiescence'
      )
    }
    let failure: unknown = error
    try {
      releaseLock()
    } catch (cleanupError) {
      failure = new AggregateError([failure, cleanupError], 'Consumer build lock cleanup failed')
    }
    try {
      rmSync(privateDir, { recursive: true, force: true })
    } catch (cleanupError) {
      failure = new AggregateError([failure, cleanupError], 'Consumer archive cleanup failed')
    }
    throw failure
  }
}
