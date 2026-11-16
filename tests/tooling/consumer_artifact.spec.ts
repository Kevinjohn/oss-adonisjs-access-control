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
      const snapshot = await consumerArtifact(root, source, {
        unconfirmedProducer: undefined,
        run: async () => '',
      })
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
      const first = await consumerArtifact(root, undefined, {
        unconfirmedProducer: undefined,
        run: async (_cwd, args) => {
          if (args[0] === 'build')
            await assert.rejects(
              () =>
                consumerArtifact(root, undefined, {
                  unconfirmedProducer: undefined,
                  run: async () => assert.fail('overlapping build ran'),
                }),
              /Default consumer build lock exists/
            )
          if (args[0] === 'pack') writeFileSync(args[2], 'archive')
          return ''
        },
      })
      first.cleanup()
      await assert.rejects(
        () =>
          consumerArtifact(root, undefined, {
            unconfirmedProducer: undefined,
            run: async () => {
              throw new Error('build failed')
            },
          }),
        /build failed/
      )
      const retry = await consumerArtifact(root, undefined, {
        unconfirmedProducer: undefined,
        run: async (_cwd, args) => {
          if (args[0] === 'pack') writeFileSync(args[2], 'retry archive')
          return ''
        },
      })
      retry.cleanup()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

test('default build keeps its claim until a TERM-resistant writer is stopped', async ({
  assert,
}) => {
  const { spawn } = await import('node:child_process')
  const { existsSync } = await import('node:fs')
  const { chmodSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const root = mkdtempSync(join(tmpdir(), 'consumer_group_test_'))
  const logs = join(root, 'logs')
  const shim = join(root, 'shim')
  const ready = join(root, 'writer_ready')
  const term = join(root, 'writer_term')
  const groupLeader = join(root, 'group_leader')
  const lock = join(root, 'tmp', 'consumer-build.lock')
  mkdirSync(logs)
  mkdirSync(shim)
  const writer = join(root, 'writer.cjs')
  writeFileSync(
    writer,
    `const fs = require('node:fs'); process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(term)}, 'TERM'); }); fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`
  )
  const pnpm = join(shim, 'pnpm')
  writeFileSync(
    pnpm,
    `#!/bin/sh\nif [ "$1" = build ]; then\n  printf '%s' "$$" > ${JSON.stringify(groupLeader)}\n  node ${JSON.stringify(writer)} >/dev/null 2>&1 &\n  trap 'exit 143' TERM\n  wait $!\n  exit 0\nfi\nif [ "$1" = pack ]; then printf archive > "$3"; exit 0; fi\nexit 9\n`
  )
  chmodSync(pnpm, 0o755)
  const loader = fileURLToPath(import.meta.resolve('@poppinss/ts-exec'))
  const helper = fileURLToPath(new URL('../../bin/helpers/consumer_artifact.ts', import.meta.url))
  const runnerModule = fileURLToPath(
    new URL('../../bin/helpers/consumer_process.ts', import.meta.url)
  )
  const source = `import { ConsumerProcessRunner } from ${JSON.stringify(runnerModule)}; import { consumerArtifact } from ${JSON.stringify(helper)}; const runner = new ConsumerProcessRunner(${JSON.stringify(logs)}); process.on('SIGTERM', () => runner.interrupt('SIGTERM')); process.on('SIGINT', () => runner.interrupt('SIGINT')); try { await consumerArtifact(${JSON.stringify(root)}, undefined, runner) } catch (error) { console.error(error); process.exitCode = runner.interruptedBy === 'SIGTERM' ? 143 : runner.interruptedBy === 'SIGINT' ? 130 : 1 }`
  let childError = ''
  const child = spawn(
    process.execPath,
    ['--import', loader, '--input-type=module', '--eval', source],
    {
      env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  child.stderr.on('data', (chunk: Buffer) => {
    childError += chunk.toString()
  })
  const waitFor = async (path: string) => {
    const deadline = Date.now() + 5000
    while (!existsSync(path)) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  try {
    await waitFor(ready)
    const owner = readFileSync(lock, 'utf8')
    const writerPid = Number(readFileSync(ready, 'utf8'))
    child.kill('SIGTERM')
    await waitFor(term)
    const leaderPid = Number(readFileSync(groupLeader, 'utf8'))
    const leaderDeadline = Date.now() + 5000
    while (true) {
      try {
        process.kill(leaderPid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') break
        throw error
      }
      if (Date.now() >= leaderDeadline) throw new Error('Build leader did not exit')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const holdDeadline = Date.now() + 250
    while (Date.now() < holdDeadline) {
      assert.equal(readFileSync(lock, 'utf8'), owner)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.doesNotThrow(() => process.kill(writerPid, 0))
    assert.equal(readFileSync(lock, 'utf8'), owner)
    await assert.rejects(
      () =>
        consumerArtifact(root, undefined, {
          unconfirmedProducer: undefined,
          run: async () => assert.fail('competing build ran'),
        }),
      /Default consumer build lock exists/
    )
    child.kill('SIGINT')
    const exit = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
      child.once('exit', (code, signal) => resolve([code, signal]))
    )
    assert.deepEqual(exit, [143, null])
    if (existsSync(lock)) {
      // Hosts that do not reap orphaned group members retain the claim conservatively.
      assert.equal(readFileSync(lock, 'utf8'), owner)
      assert.include(childError, 'could not be confirmed stopped')
    } else {
      const retry = await consumerArtifact(root, undefined, {
        unconfirmedProducer: undefined,
        run: async (_cwd, args) => {
          if (args[0] === 'pack') writeFileSync(args[2], 'retry archive')
          return ''
        },
      })
      assert.equal(readFileSync(retry.path, 'utf8'), 'retry archive')
      retry.cleanup()
    }
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    if (process.platform !== 'win32' && existsSync(groupLeader)) {
      try {
        process.kill(-Number(readFileSync(groupLeader, 'utf8')), 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') assert.fail(String(error))
      }
    }
    rmSync(root, { recursive: true, force: true })
  }
})

test('retains the original lock when producer termination is unconfirmed', async ({ assert }) => {
  const root = mkdtempSync(join(tmpdir(), 'consumer_uncertain_test_'))
  const lock = join(root, 'tmp', 'consumer-build.lock')
  let privateArchive: string | undefined
  try {
    let failure: unknown
    try {
      await consumerArtifact(root, undefined, {
        unconfirmedProducer: { name: 'archive_build', pid: 12345 },
        run: async () => {
          throw new Error('termination probe failed')
        },
      })
    } catch (error) {
      failure = error
    }
    assert.instanceOf(failure, AggregateError)
    const details = (failure as AggregateError).errors.map(String).join('\n')
    assert.include(details, 'termination probe failed')
    assert.include(details, 'could not be confirmed stopped')
    assert.include(details, 'process group 12345')
    assert.include(details, readFileSync(lock, 'utf8'))
    privateArchive = details.match(/Retained .+ and (.+)\. Inspect/)?.[1]
    assert.isDefined(privateArchive)
    await assert.rejects(
      () =>
        consumerArtifact(root, undefined, {
          unconfirmedProducer: undefined,
          run: async () => assert.fail('competing build ran'),
        }),
      /Default consumer build lock exists/
    )
  } finally {
    if (privateArchive) rmSync(privateArchive, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('log write failure after producer exit releases the build lock', async ({ assert }) => {
  const { spawn } = await import('node:child_process')
  const { chmodSync, existsSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const root = mkdtempSync(join(tmpdir(), 'consumer_log_test_'))
  const shim = join(root, 'shim')
  const lock = join(root, 'tmp', 'consumer-build.lock')
  mkdirSync(shim)
  const pnpm = join(shim, 'pnpm')
  writeFileSync(pnpm, '#!/bin/sh\nexit 0\n')
  chmodSync(pnpm, 0o755)
  const logFile = join(root, 'logs_file')
  writeFileSync(logFile, '')
  const loader = fileURLToPath(import.meta.resolve('@poppinss/ts-exec'))
  const helper = fileURLToPath(new URL('../../bin/helpers/consumer_artifact.ts', import.meta.url))
  const runnerModule = fileURLToPath(
    new URL('../../bin/helpers/consumer_process.ts', import.meta.url)
  )
  const source = `import { ConsumerProcessRunner } from ${JSON.stringify(runnerModule)}; import { consumerArtifact } from ${JSON.stringify(helper)}; const runner = new ConsumerProcessRunner(${JSON.stringify(logFile)}); try { await consumerArtifact(${JSON.stringify(root)}, undefined, runner) } catch (error) { console.error(error); process.exitCode = 1 }`
  try {
    const child = spawn(
      process.execPath,
      ['--import', loader, '--input-type=module', '--eval', source],
      {
        env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const exit = await new Promise<number | null>((resolve) => child.once('exit', resolve))
    assert.equal(exit, 1)
    assert.include(stderr, 'ENOTDIR')
    assert.isFalse(existsSync(lock))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
