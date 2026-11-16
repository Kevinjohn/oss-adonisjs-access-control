import { test } from '@japa/runner'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { consumerArtifact } from '../../bin/helpers/consumer_artifact.js'

test.group('consumer archive snapshot', () => {
  test('keeps snapshot bytes after the supplied archive is replaced', async ({ assert }) => {
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
  if (process.platform === 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'consumer_group_test_'))
  const shim = join(root, 'shim')
  const ready = join(root, 'writer_ready')
  const term = join(root, 'writer_term')
  const groupLeader = join(root, 'group_leader')
  const lock = join(root, 'tmp', 'consumer-build.lock')
  mkdirSync(shim)
  const writer = join(root, 'writer.cjs')
  writeFileSync(
    writer,
    `const fs = require('node:fs'); process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(term)}, 'TERM'); }); fs.writeFileSync(${JSON.stringify(ready + '.tmp')}, String(process.pid)); fs.renameSync(${JSON.stringify(ready + '.tmp')}, ${JSON.stringify(ready)}); setInterval(() => {}, 1000);`
  )
  const pnpm = join(shim, 'pnpm')
  writeFileSync(
    pnpm,
    `#!/bin/sh\nif [ "$1" = build ]; then\n  printf '%s' "$$" > ${JSON.stringify(groupLeader + '.tmp')}\n  mv ${JSON.stringify(groupLeader + '.tmp')} ${JSON.stringify(groupLeader)}\n  ${JSON.stringify(process.execPath)} ${JSON.stringify(writer)} >/dev/null 2>&1 &\n  trap 'exit 143' TERM\n  wait $!\n  exit 0\nfi\nif [ "$1" = pack ]; then printf archive > "$3"; exit 0; fi\nexit 9\n`
  )
  chmodSync(pnpm, 0o755)
  const loader = fileURLToPath(import.meta.resolve('@poppinss/ts-exec'))
  const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
  cpSync(join(repositoryRoot, 'bin'), join(root, 'bin'), { recursive: true })
  cpSync(join(repositoryRoot, 'package.json'), join(root, 'package.json'))
  symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
  const cli = join(root, 'bin', 'test_consumer.ts')
  let childError = ''
  const child = spawn(
    process.execPath,
    ['--import', loader, cli, '--profile=floor', '--database=sqlite', '--scaffold-only'],
    {
      env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  const exitObserved = new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Consumer CLI did not close')), 20_000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolve([code, signal])
    })
  })
  void exitObserved.catch(() => {})
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
    const writerPid = fixturePid(readFileSync(ready, 'utf8'))
    child.kill('SIGTERM')
    await waitFor(term)
    const leaderPid = fixturePid(readFileSync(groupLeader, 'utf8'))
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
    assert.equal(readFileSync(lock, 'utf8'), owner)
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
    const exit = await exitObserved
    assert.deepEqual(exit, [143, null])
    if (groupAlive(leaderPid)) {
      assert.equal(readFileSync(lock, 'utf8'), owner)
      assert.include(childError, 'could not be confirmed stopped')
    } else if (existsSync(lock)) {
      // An unconfirmed final probe can retain the claim after later observed disappearance.
      assert.equal(readFileSync(lock, 'utf8'), owner)
      assert.include(childError, 'could not be confirmed stopped')
    } else {
      assert.isFalse(groupAlive(leaderPid))
      assert.throws(() => process.kill(writerPid, 0), /ESRCH/)
    }
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    if (existsSync(groupLeader)) {
      try {
        const ownedGroup = fixturePid(readFileSync(groupLeader, 'utf8'))
        if (groupAlive(ownedGroup)) process.kill(-ownedGroup, 'SIGKILL')
        const teardownDeadline = Date.now() + 5000
        while (groupAlive(ownedGroup)) {
          if (Date.now() >= teardownDeadline)
            assert.fail('Owned fixture group did not stop before removal')
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') assert.fail(String(error))
      }
    }
    await exitObserved.catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
}).timeout(25_000)

function fixturePid(record: string): number {
  const value = record.trim()
  if (!/^[0-9]+$/.test(value)) throw new Error('Incomplete fixture process record')
  const pid = Number(value)
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid fixture process record')
  return pid
}

test('incomplete fixture records never select a signal target', ({ assert }) => {
  const source = `${fixturePid.toString()}
    const calls = [];
    process.kill = (pid, signal) => { calls.push([pid, signal]); return true; };
    for (const value of ['', ' ', '0', '1', '-2', 'abc', '12.3', '9007199254740992']) {
      try { process.kill(-fixturePid(value), 'SIGKILL'); throw new Error('Invalid record accepted'); }
      catch (error) { if (error.message === 'Invalid record accepted') throw error; }
    }
    if (calls.length !== 0) throw new Error('Malformed record selected a signal target');
    process.kill(-fixturePid('123'), 'SIGKILL');
    if (calls.length !== 1 || calls[0][0] !== -123) throw new Error('Valid record was not selected');`
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
})

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

test('the real CLI releases a reaped interrupted producer and permits a retry', async ({
  assert,
}) => {
  if (process.platform === 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'consumer_retry_test_'))
  const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
  const shim = join(root, 'shim')
  const ready = join(root, 'ready')
  const retryMode = join(root, 'retry_mode')
  const retryStarted = join(root, 'retry_started')
  const lock = join(root, 'tmp', 'consumer-build.lock')
  mkdirSync(shim)
  cpSync(join(repositoryRoot, 'bin'), join(root, 'bin'), { recursive: true })
  cpSync(join(repositoryRoot, 'package.json'), join(root, 'package.json'))
  symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
  const pnpm = join(shim, 'pnpm')
  writeFileSync(
    pnpm,
    `#!/bin/sh\nif [ "$1" = build ]; then\n  if [ -f ${JSON.stringify(retryMode)} ]; then\n    touch ${JSON.stringify(retryStarted)}\n    exit 47\n  fi\n  printf '%s' "$$" > ${JSON.stringify(ready + '.tmp')}\n  mv ${JSON.stringify(ready + '.tmp')} ${JSON.stringify(ready)}\n  trap 'exit 143' TERM\n  while :; do sleep 1; done\nfi\nexit 9\n`
  )
  chmodSync(pnpm, 0o755)
  const loader = fileURLToPath(import.meta.resolve('@poppinss/ts-exec'))
  const launch = () => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        loader,
        join(root, 'bin', 'test_consumer.ts'),
        '--profile=floor',
        '--database=sqlite',
        '--scaffold-only',
      ],
      {
        env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.stdout.on('data', () => {})
    const closed = new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Consumer CLI did not close')), 20_000)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    void closed.catch(() => {})
    return { child, closed, stderr: () => stderr }
  }
  const first = launch()
  let producer: number | undefined
  try {
    const deadline = Date.now() + 5000
    while (!existsSync(ready)) {
      if (Date.now() >= deadline) throw new Error('Producer did not publish readiness')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    producer = fixturePid(readFileSync(ready, 'utf8'))
    assert.isTrue(groupAlive(producer))
    assert.isTrue(existsSync(lock))
    first.child.kill('SIGTERM')
    assert.equal(await first.closed, 143)
    assert.include(first.stderr(), 'Interrupted by SIGTERM')
    assert.isFalse(groupAlive(producer))
    assert.isFalse(existsSync(lock))
    writeFileSync(retryMode, '')
    const retry = launch()
    assert.equal(await retry.closed, 1)
    assert.isTrue(existsSync(retryStarted))
    assert.include(retry.stderr(), 'exited with code 47')
    assert.isFalse(existsSync(lock))
  } finally {
    if (first.child.exitCode === null) first.child.kill('SIGKILL')
    if (producer && groupAlive(producer)) process.kill(-producer, 'SIGKILL')
    await first.closed.catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
}).timeout(25_000)

test('the real CLI drains a long preflight recovery diagnostic', async ({ assert }) => {
  const root = mkdtempSync(join(tmpdir(), 'consumer_diagnostic_test_'))
  const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
  const lock = join(root, 'tmp', 'consumer-build.lock')
  mkdirSync(join(root, 'tmp'))
  cpSync(join(repositoryRoot, 'bin'), join(root, 'bin'), { recursive: true })
  cpSync(join(repositoryRoot, 'package.json'), join(root, 'package.json'))
  symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
  writeFileSync(lock, 'owner=' + 'x'.repeat(2_000_000))
  const loader = fileURLToPath(import.meta.resolve('@poppinss/ts-exec'))
  const child = spawn(
    process.execPath,
    ['--import', loader, join(root, 'bin', 'test_consumer.ts'), '--profile=floor'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  child.stdout.on('data', () => {})
  const closed = new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Consumer CLI did not close')), 15_000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  try {
    assert.equal(await closed, 1)
    assert.include(stderr, 'owner=' + 'x'.repeat(2_000_000))
    assert.include(stderr, 'Inspect the owner before removing a stale lock.')
    assert.isTrue(existsSync(lock))
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    await closed.catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
}).timeout(20_000)

test('the real CLI retains its original claim when group proof is unavailable', async ({
  assert,
}) => {
  if (process.platform === 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'consumer_probe_test_'))
  const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
  const shim = join(root, 'shim')
  const privateTmp = join(root, 'private')
  const ready = join(root, 'ready')
  const lock = join(root, 'tmp', 'consumer-build.lock')
  mkdirSync(shim)
  mkdirSync(privateTmp)
  cpSync(join(repositoryRoot, 'bin'), join(root, 'bin'), { recursive: true })
  cpSync(join(repositoryRoot, 'package.json'), join(root, 'package.json'))
  symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
  const pnpm = join(shim, 'pnpm')
  writeFileSync(
    pnpm,
    `#!/bin/sh\nif [ "$1" = build ]; then\n  printf '%s' "$$" > ${JSON.stringify(ready + '.tmp')}\n  mv ${JSON.stringify(ready + '.tmp')} ${JSON.stringify(ready)}\n  trap 'exit 143' TERM\n  while :; do sleep 1; done\nfi\nexit 9\n`
  )
  chmodSync(pnpm, 0o755)
  const fault = join(root, 'probe_fault.mjs')
  writeFileSync(
    fault,
    `const original = process.kill.bind(process); process.kill = (pid, signal) => { if (pid < 0 && signal === 0) { const error = new Error('probe unavailable'); error.code = 'EPERM'; throw error; } if (pid < 0 && signal === 'SIGKILL') { const error = new Error('fixture group already stopped'); error.code = 'ESRCH'; throw error; } return original(pid, signal); };`
  )
  const loader = fileURLToPath(import.meta.resolve('@poppinss/ts-exec'))
  const child = spawn(
    process.execPath,
    [
      '--import',
      fault,
      '--import',
      loader,
      join(root, 'bin', 'test_consumer.ts'),
      '--profile=floor',
      '--database=sqlite',
      '--scaffold-only',
    ],
    {
      env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, TMPDIR: privateTmp },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  child.stdout.on('data', () => {})
  const closed = new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Consumer CLI did not close')), 18_000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  void closed.catch(() => {})
  let producer: number | undefined
  try {
    const deadline = Date.now() + 5000
    while (!existsSync(ready)) {
      if (Date.now() >= deadline) throw new Error('Producer did not publish readiness')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    producer = fixturePid(readFileSync(ready, 'utf8'))
    const owner = readFileSync(lock, 'utf8')
    child.kill('SIGTERM')
    assert.equal(await closed, 143)
    assert.isFalse(groupAlive(producer))
    assert.equal(readFileSync(lock, 'utf8'), owner)
    assert.include(stderr, 'could not be confirmed stopped')
    assert.include(stderr, owner)
    const retained = stderr.match(/Retained .+ and (.+)\. Inspect/)?.[1]
    assert.isDefined(retained)
    assert.isTrue(existsSync(retained!))
    assert.isTrue(retained!.startsWith(privateTmp))
    await assert.rejects(
      () =>
        consumerArtifact(root, undefined, {
          unconfirmedProducer: undefined,
          run: async () => assert.fail('competing build ran'),
        }),
      /Default consumer build lock exists/
    )
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    if (producer && groupAlive(producer)) process.kill(-producer, 'SIGKILL')
    await closed.catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
}).timeout(25_000)

test('the real CLI reports primary and archive cleanup failures together', async ({ assert }) => {
  const root = mkdtempSync(join(tmpdir(), 'consumer_cleanup_test_'))
  const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
  const privateTmp = join(root, 'private')
  const packageDir = join(root, 'package')
  mkdirSync(privateTmp)
  mkdirSync(packageDir)
  cpSync(join(repositoryRoot, 'bin'), join(root, 'bin'), { recursive: true })
  cpSync(join(repositoryRoot, 'package.json'), join(root, 'package.json'))
  symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({
      peerDependencies: {
        '@adonisjs/core': '^7.0.0',
        '@adonisjs/auth': '^10.0.0',
        '@adonisjs/bouncer': '^4.0.0',
        '@adonisjs/lucid': '^22.4.2',
        'luxon': '^3.4.4',
        'typescript': '^5.9.3',
      },
    })
  )
  const archive = join(root, 'input.tgz')
  execFileSync('tar', ['-czf', archive, '-C', root, 'package'])
  const fault = join(root, 'cleanup_fault.mjs')
  writeFileSync(
    fault,
    `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'; const original = fs.rmSync; fs.rmSync = (path, options) => { if (String(path).includes('access_control_archive_')) throw new Error('archive cleanup injected'); return original(path, options); }; syncBuiltinESMExports();`
  )
  const loader = fileURLToPath(import.meta.resolve('@poppinss/ts-exec'))
  const child = spawn(
    process.execPath,
    [
      '--import',
      fault,
      '--import',
      loader,
      join(root, 'bin', 'test_consumer.ts'),
      `--package=${archive}`,
      '--profile=floor',
      '--database=sqlite',
      '--scaffold-only',
    ],
    { env: { ...process.env, TMPDIR: privateTmp }, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  child.stdout.on('data', () => {})
  const closed = new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Consumer CLI did not close')), 15_000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  try {
    assert.equal(await closed, 1)
    assert.include(stderr, 'ENOENT')
    assert.include(stderr, 'archive cleanup injected')
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    await closed.catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
}).timeout(20_000)

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
  if (process.platform === 'win32') return
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
