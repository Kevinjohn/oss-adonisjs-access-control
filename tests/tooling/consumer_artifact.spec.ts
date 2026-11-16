import { test } from '@japa/runner'
import fs, {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
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

  test('reports contention without following a linked or non-file lock', async ({ assert }) => {
    const root = mkdtempSync(join(tmpdir(), 'consumer_unsafe_lock_test_'))
    const lock = join(root, 'tmp', 'consumer-build.lock')
    const target = join(root, 'private-owner')
    mkdirSync(join(root, 'tmp'))
    writeFileSync(target, 'unrelated private contents')
    try {
      const run = () =>
        consumerArtifact(root, undefined, {
          unconfirmedProducer: undefined,
          run: async () => assert.fail('contending build ran'),
        })
      symlinkSync(target, lock)
      await assert.rejects(run, /owner unavailable/)
      assert.isTrue(existsSync(lock))
      assert.isTrue(lstatSync(lock).isSymbolicLink())
      assert.equal(readFileSync(target, 'utf8'), 'unrelated private contents')

      rmSync(lock)
      mkdirSync(lock)
      await assert.rejects(run, /owner unavailable/)
      assert.isTrue(existsSync(lock))

      if (process.platform === 'linux') {
        rmSync(lock, { recursive: true })
        execFileSync('mkfifo', [lock])
        await assert.rejects(run, /owner unavailable/)
        assert.isTrue(existsSync(lock))
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('reports contention when the owner lock disappears after EEXIST', async ({ assert }) => {
    const root = mkdtempSync(join(tmpdir(), 'consumer_vanished_lock_test_'))
    const lock = join(root, 'tmp', 'consumer-build.lock')
    mkdirSync(join(root, 'tmp'))
    writeFileSync(lock, 'current owner record')

    const originalOpenSync = fs.openSync
    let lockClaims = 0
    let producerInvocations = 0
    let removedAfterConflict = false
    fs.openSync = ((path, flags, mode) => {
      if (path === lock && flags === 'wx') lockClaims++
      try {
        return originalOpenSync(path, flags, mode)
      } catch (error) {
        if (path === lock && flags === 'wx' && (error as NodeJS.ErrnoException).code === 'EEXIST') {
          rmSync(lock)
          removedAfterConflict = true
        }
        throw error
      }
    }) as typeof fs.openSync
    syncBuiltinESMExports()

    try {
      await assert.rejects(
        () =>
          consumerArtifact(root, undefined, {
            unconfirmedProducer: undefined,
            run: async () => {
              producerInvocations++
              return ''
            },
          }),
        /Default consumer build lock exists.*owner unavailable/
      )
      assert.isTrue(removedAfterConflict)
      assert.equal(lockClaims, 1)
      assert.equal(producerInvocations, 0)
      assert.isFalse(existsSync(lock))
    } finally {
      fs.openSync = originalOpenSync
      syncBuiltinESMExports()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

test('default build keeps its claim until a TERM-resistant writer is stopped', async ({
  assert,
}) => {
  if (process.platform === 'win32') return
  const tempParent = mkdtempSync(join(tmpdir(), 'consumer path $; test_'))
  const root = mkdtempSync(join(tempParent, 'consumer_group_test_'))
  const shim = join(root, 'shim')
  const ready = join(root, 'writer_ready')
  const term = join(root, 'writer_term')
  const stop = join(root, 'writer_stop')
  const groupLeader = join(root, 'group_leader')
  const lock = join(root, 'tmp', 'consumer-build.lock')
  const privateTmp = join(root, 'private')
  mkdirSync(shim)
  mkdirSync(privateTmp)
  const writer = join(root, 'writer.cjs')
  writeFileSync(
    writer,
    "const fs = require('node:fs'); const path = require('node:path'); const term = path.join(__dirname, 'writer_term'); const ready = path.join(__dirname, 'writer_ready'); const stop = path.join(__dirname, 'writer_stop'); process.on('SIGTERM', () => { fs.writeFileSync(term, 'TERM'); }); fs.writeFileSync(ready + '.tmp', String(process.pid)); fs.renameSync(ready + '.tmp', ready); setInterval(() => { if (fs.existsSync(stop)) process.exit(0); }, 20);"
  )
  const pnpm = join(shim, 'pnpm')
  writeFileSync(
    pnpm,
    '#!/bin/sh\nif [ "$1" = build ]; then\n  printf \'%s\' "$$" > "$CONSUMER_FIXTURE_ROOT/group_leader.tmp"\n  mv "$CONSUMER_FIXTURE_ROOT/group_leader.tmp" "$CONSUMER_FIXTURE_ROOT/group_leader"\n  "$CONSUMER_NODE_EXECUTABLE" "$CONSUMER_FIXTURE_ROOT/writer.cjs" >/dev/null 2>&1 &\n  trap \'exit 143\' TERM\n  wait $!\n  exit 0\nfi\nif [ "$1" = pack ]; then printf archive > "$3"; exit 0; fi\nexit 9\n'
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
      env: {
        ...process.env,
        PATH: `${shim}:${process.env.PATH}`,
        TMPDIR: privateTmp,
        CONSUMER_FIXTURE_ROOT: root,
        CONSUMER_NODE_EXECUTABLE: process.execPath,
      },
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
  let writerAlive: (() => boolean) | undefined
  try {
    await waitFor(ready)
    const owner = readFileSync(lock, 'utf8')
    const writerPid = fixturePid(readFileSync(ready, 'utf8'))
    writerAlive = observeWriter(writerPid)
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
    assert.isTrue(writerAlive())
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
    const groupAlive = observeGroup(leaderPid)
    if (groupAlive()) {
      assert.equal(readFileSync(lock, 'utf8'), owner)
      assert.include(childError, 'could not be confirmed stopped')
    } else if (existsSync(lock)) {
      // An unconfirmed final probe can retain the claim after later observed disappearance.
      assert.equal(readFileSync(lock, 'utf8'), owner)
      assert.include(childError, 'could not be confirmed stopped')
    } else {
      assert.isFalse(writerAlive())
    }
  } finally {
    writeFileSync(stop, '')
    await closeOwnedCli(child)
    if (!writerAlive && existsSync(ready))
      writerAlive = observeWriter(fixturePid(readFileSync(ready, 'utf8')))
    const writerStopped = writerAlive ? await waitUntilStopped(writerAlive, 5000) : false
    if (writerStopped) {
      rmSync(root, { recursive: true, force: true })
      rmSync(tempParent, { recursive: true, force: true })
    } else assert.fail('Fixture writer remained executable; retained its private directory')
  }
}).timeout(25_000)

function fixturePid(record: string): number {
  const value = record.trim()
  if (!/^[0-9]+$/.test(value)) throw new Error('Incomplete fixture process record')
  const pid = Number(value)
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid fixture process record')
  return pid
}

function observeGroup(pid: number): () => boolean {
  let retired = false
  return () => {
    if (retired) return false
    try {
      process.kill(-pid, 0)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        retired = true
        return false
      }
      throw error
    }
  }
}

function observeWriter(pid: number): () => boolean {
  let retired = false
  return () => {
    if (retired) return false
    try {
      process.kill(pid, 0)
      if (process.platform === 'linux') {
        const state = readFileSync(`/proc/${pid}/stat`, 'utf8').match(/^\d+ \(.+\) ([A-Z])/)?.[1]
        if (state === 'Z' || state === 'X') retired = true
      }
      return !retired
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === 'ESRCH' ||
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        retired = true
        return false
      }
      throw error
    }
  }
}

async function waitUntilStopped(isAlive: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (isAlive()) {
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return true
}

async function closeOwnedCli(child: ReturnType<typeof spawn>): Promise<void> {
  const closed = () =>
    (child.exitCode !== null || child.signalCode !== null) &&
    (child.stdout?.closed ?? true) &&
    (child.stderr?.closed ?? true)
  const waitClose = (timeoutMs: number) =>
    new Promise<void>((resolve, reject) => {
      if (closed()) return resolve()
      const timer = setTimeout(() => {
        child.removeListener('close', onClose)
        child.removeListener('error', onError)
        reject(new Error('Owned consumer CLI did not close'))
      }, timeoutMs)
      const onClose = () => {
        clearTimeout(timer)
        child.removeListener('error', onError)
        resolve()
      }
      const onError = (error: Error) => {
        clearTimeout(timer)
        child.removeListener('close', onClose)
        reject(error)
      }
      child.once('close', onClose)
      child.once('error', onError)
    })
  if (closed()) return
  const stopped = waitClose(12_000)
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    child.kill('SIGINT')
  }
  try {
    await stopped
  } catch {
    const killed = waitClose(5000)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await killed
  }
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

test('the real CLI releases a reaped interrupted producer and permits a retry', async ({
  assert,
}) => {
  if (process.platform === 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'consumer_retry_test_'))
  const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
  const shim = join(root, 'shim')
  const ready = join(root, 'ready')
  const stop = join(root, 'stop')
  const retryMode = join(root, 'retry_mode')
  const retryStarted = join(root, 'retry_started')
  const lock = join(root, 'tmp', 'consumer-build.lock')
  const privateTmp = join(root, 'private')
  mkdirSync(shim)
  mkdirSync(privateTmp)
  cpSync(join(repositoryRoot, 'bin'), join(root, 'bin'), { recursive: true })
  cpSync(join(repositoryRoot, 'package.json'), join(root, 'package.json'))
  symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
  const pnpm = join(shim, 'pnpm')
  writeFileSync(
    pnpm,
    `#!/bin/sh
if [ "$1" = build ]; then
  if [ -f "$CONSUMER_FIXTURE_ROOT/retry_mode" ]; then
    touch "$CONSUMER_FIXTURE_ROOT/retry_started"
    exit 47
  fi
  trap 'exit 143' TERM
  printf '%s' "$$" > "$CONSUMER_FIXTURE_ROOT/ready.tmp"
  mv "$CONSUMER_FIXTURE_ROOT/ready.tmp" "$CONSUMER_FIXTURE_ROOT/ready"
  while :; do
    if [ -f "$CONSUMER_FIXTURE_ROOT/stop" ]; then exit 0; fi
    sleep 1
  done
fi
exit 9
`
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
        env: {
          ...process.env,
          PATH: `${shim}:${process.env.PATH}`,
          TMPDIR: privateTmp,
          CONSUMER_FIXTURE_ROOT: root,
          CONSUMER_NODE_EXECUTABLE: process.execPath,
        },
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
  let retry: ReturnType<typeof launch> | undefined
  let firstGroupAlive: (() => boolean) | undefined
  try {
    const deadline = Date.now() + 5000
    while (!existsSync(ready)) {
      if (Date.now() >= deadline) throw new Error('Producer did not publish readiness')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    firstGroupAlive = observeGroup(fixturePid(readFileSync(ready, 'utf8')))
    assert.isTrue(firstGroupAlive())
    assert.isTrue(existsSync(lock))
    first.child.kill('SIGTERM')
    assert.equal(await first.closed, 143)
    assert.include(first.stderr(), 'Interrupted by SIGTERM')
    assert.isFalse(firstGroupAlive())
    assert.isFalse(existsSync(lock))
    writeFileSync(retryMode, '')
    retry = launch()
    assert.equal(await retry.closed, 1)
    assert.isTrue(existsSync(retryStarted))
    assert.include(retry.stderr(), 'exited with code 47')
    assert.isFalse(existsSync(lock))
  } finally {
    writeFileSync(stop, '')
    await closeOwnedCli(first.child)
    if (retry) await closeOwnedCli(retry.child)
    if (!firstGroupAlive && existsSync(ready))
      firstGroupAlive = observeGroup(fixturePid(readFileSync(ready, 'utf8')))
    const stopped = firstGroupAlive ? await waitUntilStopped(firstGroupAlive, 5000) : false
    if (stopped) rmSync(root, { recursive: true, force: true })
    else assert.fail('First fixture group remained active; retained its private directory')
  }
}).timeout(25_000)

test('the real CLI drains a long preflight recovery diagnostic', async ({ assert }) => {
  if (process.platform === 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'consumer_diagnostic_test_'))
  const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
  const lock = join(root, 'tmp', 'consumer-build.lock')
  mkdirSync(join(root, 'tmp'))
  cpSync(join(repositoryRoot, 'bin'), join(root, 'bin'), { recursive: true })
  cpSync(join(repositoryRoot, 'package.json'), join(root, 'package.json'))
  symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
  writeFileSync(lock, 'owner=' + 'x'.repeat(2_000_000))
  const fault = join(root, 'signal_drain.mjs')
  writeFileSync(
    fault,
    `const original = console.error; let sent = false; console.error = (...args) => { if (!sent) { sent = true; process.kill(process.pid, 'SIGTERM'); } original(...args); }; process.on('SIGTERM', () => process.stdout.write('first-signal-observed\\n')); process.on('SIGINT', () => process.stdout.write('second-listener-count:' + process.listenerCount('SIGINT') + '\\n'));`
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
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  child.stderr.pause()
  let stdout = ''
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  const waitForOutput = async (marker: string) => {
    const deadline = Date.now() + 5000
    while (!stdout.includes(marker)) {
      if (Date.now() >= deadline) throw new Error(`Consumer CLI did not report ${marker}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
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
  void closed.catch(() => {})
  try {
    await waitForOutput('first-signal-observed')
    child.kill('SIGINT')
    await waitForOutput('second-listener-count:2')
    child.stderr.resume()
    assert.equal(await closed, 143)
    assert.include(stderr, 'owner=' + 'x'.repeat(2_000_000))
    assert.include(stderr, 'Inspect the owner before removing a stale lock.')
    assert.isTrue(existsSync(lock))
  } finally {
    child.stderr.resume()
    await closeOwnedCli(child)
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
  const stop = join(root, 'stop')
  const lock = join(root, 'tmp', 'consumer-build.lock')
  mkdirSync(shim)
  mkdirSync(privateTmp)
  cpSync(join(repositoryRoot, 'bin'), join(root, 'bin'), { recursive: true })
  cpSync(join(repositoryRoot, 'package.json'), join(root, 'package.json'))
  symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
  const pnpm = join(shim, 'pnpm')
  writeFileSync(
    pnpm,
    `#!/bin/sh
if [ "$1" = build ]; then
  trap 'exit 143' TERM
  printf '%s' "$$" > "$CONSUMER_FIXTURE_ROOT/ready.tmp"
  mv "$CONSUMER_FIXTURE_ROOT/ready.tmp" "$CONSUMER_FIXTURE_ROOT/ready"
  while :; do
    if [ -f "$CONSUMER_FIXTURE_ROOT/stop" ]; then exit 0; fi
    sleep 1
  done
fi
exit 9
`
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
      env: {
        ...process.env,
        PATH: `${shim}:${process.env.PATH}`,
        TMPDIR: privateTmp,
        CONSUMER_FIXTURE_ROOT: root,
        CONSUMER_NODE_EXECUTABLE: process.execPath,
      },
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
  let producerGroupAlive: (() => boolean) | undefined
  try {
    const deadline = Date.now() + 5000
    while (!existsSync(ready)) {
      if (Date.now() >= deadline) throw new Error('Producer did not publish readiness')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    producerGroupAlive = observeGroup(fixturePid(readFileSync(ready, 'utf8')))
    const owner = readFileSync(lock, 'utf8')
    child.kill('SIGTERM')
    assert.equal(await closed, 143)
    assert.isFalse(producerGroupAlive())
    assert.include(stderr, 'could not be confirmed stopped')
    assert.include(stderr, owner)
    const retained = stderr.match(/Retained .+ and (.+)\. Inspect/)?.[1]
    assert.isDefined(retained)
    assert.isTrue(existsSync(retained!))
    assert.isTrue(retained!.startsWith(privateTmp))
    assert.equal(readFileSync(lock, 'utf8'), owner)
    await assert.rejects(
      () =>
        consumerArtifact(root, undefined, {
          unconfirmedProducer: undefined,
          run: async () => assert.fail('competing build ran'),
        }),
      /Default consumer build lock exists/
    )
  } finally {
    writeFileSync(stop, '')
    await closeOwnedCli(child)
    if (!producerGroupAlive && existsSync(ready))
      producerGroupAlive = observeGroup(fixturePid(readFileSync(ready, 'utf8')))
    const stopped = producerGroupAlive ? await waitUntilStopped(producerGroupAlive, 5000) : false
    if (stopped) rmSync(root, { recursive: true, force: true })
    else assert.fail('Fixture group remained active; retained its private directory')
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
  child.stdout.on('data', () => {})
  const closed = new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Consumer log fixture did not close')), 15_000)
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
  try {
    assert.equal(await closed, 1)
    assert.include(stderr, 'ENOTDIR')
    assert.isFalse(existsSync(lock))
  } finally {
    await closeOwnedCli(child)
    rmSync(root, { recursive: true, force: true })
  }
}).timeout(20_000)
