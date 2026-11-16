import { test } from '@japa/runner'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { consumerArtifact } from '../../bin/helpers/consumer_artifact.js'

test.group('consumer archive snapshot', () => {
  test('keeps installed bytes after the supplied archive is replaced', async ({ assert }) => {
    const root = mkdtempSync(join(tmpdir(), 'consumer_snapshot_test_'))
    const source = join(root, 'external.tgz')
    writeFileSync(source, 'original archive')
    try {
      const snapshot = await consumerArtifact(root, source)
      try {
        writeFileSync(source, 'replacement archive')
        assert.equal(readFileSync(snapshot.path, 'utf8'), 'original archive')
      } finally {
        snapshot.cleanup()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('refuses overlapping default builds and releases the lock after failure', async ({
    assert,
  }) => {
    const root = mkdtempSync(join(tmpdir(), 'consumer_build_test_'))
    mkdirSync(join(root, 'tmp'))
    try {
      const first = await consumerArtifact(root, undefined, async (_cwd, args) => {
        if (args[0] === 'build')
          await assert.rejects(
            () => consumerArtifact(root, undefined, () => assert.fail('overlapping build ran')),
            /Default consumer build lock exists/
          )
        if (args[0] === 'pack') writeFileSync(args[2], 'archive')
      })
      first.cleanup()
      await assert.rejects(
        () =>
          consumerArtifact(root, undefined, () => {
            throw new Error('build failed')
          }),
        /build failed/
      )
      const retry = await consumerArtifact(root, undefined, (_cwd, args) => {
        if (args[0] === 'pack') writeFileSync(args[2], 'retry archive')
      })
      retry.cleanup()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

test('an interrupted default build releases its owned lock for retry', async ({ assert }) => {
  const { spawn } = await import('node:child_process')
  const { existsSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const root = mkdtempSync(join(tmpdir(), 'consumer_interrupt_test_'))
  const helper = fileURLToPath(new URL('../../bin/helpers/consumer_artifact.ts', import.meta.url))
  const loader = fileURLToPath(import.meta.resolve('@poppinss/ts-exec'))
  const runnerSource = `import { consumerArtifact } from ${JSON.stringify(helper)}; await consumerArtifact(${JSON.stringify(root)}, undefined, async (_root, args, signal) => { if (args[0] === 'build') { process.stdout.write('BUILD_STARTED\\n'); const hold = setInterval(() => {}, 1000); try { await new Promise((_resolve, reject) => { if (signal.aborted) reject(new Error('aborted')); else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }) }) } finally { clearInterval(hold) } } })`
  const child = spawn(
    process.execPath,
    ['--import', loader, '--input-type=module', '--eval', runnerSource],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  try {
    await new Promise<void>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error('Default build did not start')), 5000)
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        if (output.includes('BUILD_STARTED')) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.once('error', reject)
      child.once('exit', (exitCode) => reject(new Error(`Default build exited early: ${exitCode}`)))
    })
    assert.isTrue(existsSync(join(root, 'tmp', 'consumer-build.lock')))
    child.kill('SIGTERM')
    const exit = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
      child.once('exit', (exitCode, signal) => resolve([exitCode, signal]))
    )
    assert.deepEqual(exit, [143, null])
    assert.isFalse(existsSync(join(root, 'tmp', 'consumer-build.lock')))
    const retry = await consumerArtifact(root, undefined, (_cwd, args) => {
      if (args[0] === 'pack') writeFileSync(args[2], 'retry archive')
    })
    retry.cleanup()
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    rmSync(root, { recursive: true, force: true })
  }
})
