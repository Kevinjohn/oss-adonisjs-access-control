import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { ConsumerProcessRunner } from '../../bin/helpers/consumer_process.js'

test('a late signal cannot target a confirmed stopped consumer group', async ({ assert }) => {
  if (process.platform === 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'consumer_signal_test_'))
  const shim = join(root, 'shim')
  const log = join(root, 'archive_build.log')
  mkdirSync(shim)
  execFileSync('mkfifo', [log])
  const pnpm = join(shim, 'pnpm')
  writeFileSync(pnpm, '#!/bin/sh\nexit 0\n')
  chmodSync(pnpm, 0o755)
  const runner = new ConsumerProcessRunner(root)
  const originalKill = process.kill
  let observedGroupSignals = 0
  let reading: Promise<string> | undefined
  try {
    const running = runner.run(root, ['build'], 'archive_build', {
      ...process.env,
      PATH: `${shim}:${process.env.PATH}`,
    })
    void running.catch(() => {})
    const deadline = Date.now() + 5000
    while (runner.unconfirmedProducer !== undefined) {
      if (Date.now() >= deadline) throw new Error('The consumer group was not confirmed stopped')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid < 0 && signal !== 0) {
        observedGroupSignals++
        return true
      }
      return originalKill(pid, signal)
    }) as typeof process.kill
    runner.interrupt('SIGTERM')
    runner.interrupt('SIGINT')
    assert.equal(observedGroupSignals, 0)
    reading = readFile(log, 'utf8')
    await assert.rejects(() => running, /Interrupted by SIGTERM/)
    await reading
  } finally {
    process.kill = originalKill
    if (!reading) reading = readFile(log, 'utf8')
    await reading.catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
}).timeout(15_000)

test('a second signal accelerates a still-owned consumer group', async ({ assert }) => {
  if (process.platform === 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'consumer_escalation_test_'))
  const shim = join(root, 'shim')
  const ready = join(root, 'ready')
  const term = join(root, 'term')
  const stop = join(root, 'stop')
  mkdirSync(shim)
  const pnpm = join(shim, 'pnpm')
  writeFileSync(
    pnpm,
    `#!/bin/sh\ntrap 'touch ${term}' TERM\nprintf READY > ${JSON.stringify(ready + '.tmp')}\nmv ${JSON.stringify(ready + '.tmp')} ${JSON.stringify(ready)}\nwhile :; do\n  if [ -f ${JSON.stringify(stop)} ]; then exit 0; fi\n  sleep 1\ndone\n`
  )
  chmodSync(pnpm, 0o755)
  const runner = new ConsumerProcessRunner(root)
  const running = runner.run(root, ['build'], 'archive_build', {
    ...process.env,
    PATH: `${shim}:${process.env.PATH}`,
  })
  void running.catch(() => {})
  let escalationTimer: ReturnType<typeof setTimeout> | undefined
  const originalKill = process.kill
  const unexpectedSignals: number[] = []
  let groupRetired = false
  try {
    const waitFor = async (path: string) => {
      const deadline = Date.now() + 5000
      while (!existsSync(path)) {
        if (Date.now() >= deadline) throw new Error(`Fixture barrier did not arrive: ${path}`)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    await waitFor(ready)
    assert.equal(readFileSync(ready, 'utf8'), 'READY')
    const ownedGroup = runner.unconfirmedProducer?.pid
    if (!ownedGroup || !Number.isSafeInteger(ownedGroup) || ownedGroup <= 1)
      throw new Error('Runner did not establish a safe owned group')
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (
        signal !== 0 &&
        (pid <= 0 || !Number.isSafeInteger(pid)) &&
        (groupRetired || pid !== -ownedGroup)
      ) {
        unexpectedSignals.push(pid)
        return true
      }
      return originalKill(pid, signal)
    }) as typeof process.kill
    runner.interrupt('SIGTERM')
    await waitFor(term)
    runner.interrupt('SIGINT')
    await Promise.race([
      assert.rejects(() => running, /Interrupted by SIGTERM/),
      new Promise<never>(
        (_, reject) =>
          (escalationTimer = setTimeout(
            () => reject(new Error('Second signal did not accelerate cleanup')),
            2000
          ))
      ),
    ])
    groupRetired = true
    assert.equal(runner.interruptedBy, 'SIGTERM')
    assert.isUndefined(runner.unconfirmedProducer)
    assert.deepEqual(unexpectedSignals, [])
  } finally {
    if (escalationTimer) clearTimeout(escalationTimer)
    writeFileSync(stop, '')
    if (runner.unconfirmedProducer === undefined) groupRetired = true
    runner.interrupt('SIGTERM')
    runner.interrupt('SIGINT')
    await running.catch(() => {})
    process.kill = originalKill
    if (runner.unconfirmedProducer === undefined) rmSync(root, { recursive: true, force: true })
  }
}).timeout(15_000)
