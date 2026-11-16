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
      if (pid < 0 && signal !== 0) observedGroupSignals++
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
  mkdirSync(shim)
  const pnpm = join(shim, 'pnpm')
  writeFileSync(
    pnpm,
    `#!/bin/sh\nprintf '%s' "$$" > ${JSON.stringify(ready + '.tmp')}\nmv ${JSON.stringify(ready + '.tmp')} ${JSON.stringify(ready)}\ntrap 'touch ${term}' TERM\nwhile :; do sleep 1; done\n`
  )
  chmodSync(pnpm, 0o755)
  const runner = new ConsumerProcessRunner(root)
  const running = runner.run(root, ['build'], 'archive_build', {
    ...process.env,
    PATH: `${shim}:${process.env.PATH}`,
  })
  void running.catch(() => {})
  let group: number | undefined
  let escalationTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const waitFor = async (path: string) => {
      const deadline = Date.now() + 5000
      while (!existsSync(path)) {
        if (Date.now() >= deadline) throw new Error(`Fixture barrier did not arrive: ${path}`)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    await waitFor(ready)
    const record = readFileSync(ready, 'utf8').trim()
    group = Number(record)
    if (!/^[0-9]+$/.test(record) || !Number.isSafeInteger(group) || group <= 1)
      throw new Error('Invalid fixture process group')
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
    assert.equal(runner.interruptedBy, 'SIGTERM')
    assert.isUndefined(runner.unconfirmedProducer)
  } finally {
    if (escalationTimer) clearTimeout(escalationTimer)
    if (group) {
      try {
        process.kill(-group, 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') assert.fail(String(error))
      }
      const deadline = Date.now() + 5000
      while (true) {
        try {
          process.kill(-group, 0)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') break
          assert.fail(String(error))
        }
        if (Date.now() >= deadline) assert.fail('Fixture group did not stop before removal')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    await running.catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
}).timeout(15_000)
