import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  closeSync,
  copyFileSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ConsumerProcessRunner } from './consumer_process.js'
import { ConsumerCommandError } from './consumer_process.js'

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
          const existing = readLockOwner(lock)
          throw new Error(
            `Default consumer build lock exists at ${lock}: ${existing === undefined ? 'owner unavailable (the lock disappeared or changed during inspection)' : existing || 'owner not recorded'}. Inspect the owner before removing a stale lock.`
          )
        }
        throw error
      }
      ownsLock = true
      let creationFailure: unknown
      try {
        writeFileSync(fd, owner)
      } catch (error) {
        creationFailure = error
      } finally {
        try {
          closeSync(fd)
        } catch (error) {
          creationFailure =
            creationFailure === undefined
              ? error
              : new AggregateError([creationFailure, error], 'Consumer lock creation failed')
        }
      }
      if (creationFailure !== undefined) {
        try {
          rmSync(lock)
          ownsLock = false
        } catch (cleanupError) {
          creationFailure = new AggregateError(
            [creationFailure, cleanupError],
            'Consumer lock creation and cleanup failed'
          )
        }
        throw creationFailure
      }
      await runner.run(root, ['build'], 'archive_build', process.env)
      source = join(privateDir, `packed_${randomUUID()}.tgz`)
      await runner.run(root, ['pack', '--out', source], 'archive_pack', process.env)
    } else source = resolve(root, explicitPackage)
    const path = join(privateDir, 'package.tgz')
    copyFileSync(source, path)
    releaseLock()
    return { path, cleanup: () => rmSync(privateDir, { recursive: true, force: true }) }
  } catch (error) {
    const producer =
      error instanceof ConsumerCommandError ? error.unconfirmedProducer : runner.unconfirmedProducer
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

function readLockOwner(lock: string): string | undefined {
  let observed: BigIntStats
  try {
    observed = lstatSync(lock, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (!observed.isFile() || observed.nlink !== 1n) return undefined

  let fd: number
  try {
    fd = openSync(
      lock,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    )
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENXIO') return undefined
    throw error
  }

  let contents: string | undefined
  let readFailure: unknown
  try {
    const opened = fstatSync(fd, { bigint: true })
    let current: BigIntStats | undefined
    try {
      current = lstatSync(lock, { bigint: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const sameFile = opened.dev === observed.dev && opened.ino === observed.ino
    const nameStillMatches =
      current !== undefined && current.dev === opened.dev && current.ino === opened.ino
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      !current ||
      !current.isFile() ||
      current.nlink !== 1n ||
      !sameFile ||
      !nameStillMatches
    ) {
      contents = undefined
    } else {
      contents = readFileSync(fd, 'utf8')
    }
  } catch (error) {
    readFailure = error
  }
  try {
    closeSync(fd)
  } catch (error) {
    if (readFailure !== undefined)
      throw new AggregateError(
        [readFailure, error],
        `Could not inspect consumer build lock ${lock}`
      )
    throw error
  }
  if (readFailure !== undefined) throw readFailure
  return contents
}
