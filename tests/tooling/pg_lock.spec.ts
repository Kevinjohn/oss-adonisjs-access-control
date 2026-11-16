import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import { collectExit, outputOf, waitForFile } from '../helpers/child_process.js'

const script = fileURLToPath(new URL('../../bin/pg.sh', import.meta.url))

async function fixture(cleanup: (callback: () => Promise<void>) => void) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'access-pg-lock-'))
  cleanup(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'bin'))
  await mkdir(path.join(root, 'fake-bin'))
  await copyFile(script, path.join(root, 'bin/pg.sh'))
  const statusLog = path.join(root, 'status.log')
  const statusGate = path.join(root, 'status.gate')
  const statusReady = path.join(root, 'status.ready')
  await writeFile(statusLog, '')
  await writeFile(path.join(root, 'fake-bin/brew'), '#!/bin/sh\nexit 1\n')
  await writeFile(
    path.join(root, 'fake-bin/pg_ctl'),
    `#!/bin/bash
if [ "$1" = --version ]; then echo 'pg_ctl (PostgreSQL) 16.4'; exit 0; fi
echo status >> ${JSON.stringify(statusLog)}
touch ${JSON.stringify(statusReady)}
while [ -e ${JSON.stringify(statusGate)} ]; do sleep 0.02; done
exit 3
`
  )
  for (const utility of ['postgres', 'initdb', 'pg_isready', 'psql', 'createdb'])
    await writeFile(path.join(root, `fake-bin/${utility}`), '#!/bin/sh\nexit 0\n')
  for (const name of await readdir(path.join(root, 'fake-bin')))
    await chmod(path.join(root, 'fake-bin', name), 0o755)
  const env: NodeJS.ProcessEnv = {
    PATH: `${path.join(root, 'fake-bin')}:${path.dirname(process.execPath)}:${process.env.PATH}`,
    DB_PORT: '55437',
    HOME: root,
  }
  return { root, env, statusLog, statusGate, statusReady, lock: path.join(root, 'tmp/pg16.lock') }
}

function run(f: Awaited<ReturnType<typeof fixture>>, env = f.env): ChildProcess {
  return spawn('bash', [path.join(f.root, 'bin/pg.sh'), 'stop'], {
    cwd: f.root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function owned(child: ChildProcess, cleanup: (callback: () => Promise<void>) => void) {
  const output = await outputOf(child)
  cleanup(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await output.closed
  })
  return output
}

test('publishes a complete owner and recovers empty legacy locks', async ({ cleanup }) => {
  const f = await fixture(cleanup)
  await mkdir(path.dirname(f.lock), { recursive: true })
  for (const legacy of ['empty-directory', 'empty-owner', 'absent']) {
    await rm(f.lock, { recursive: true, force: true })
    if (legacy !== 'absent') await mkdir(f.lock)
    if (legacy === 'empty-owner') await writeFile(path.join(f.lock, 'owner'), '')
    const child = run(f)
    const output = await owned(child, cleanup)
    const result = await collectExit(child, output)
    assert.equal(result.code, 0, `${legacy}: ${result.text}`)
    assert.equal(
      await readFile(f.statusLog, 'utf8').then((value) => value.split('status').length - 1),
      ['empty-directory', 'empty-owner', 'absent'].indexOf(legacy) + 1
    )
  }
})

test('a live numeric owner is busy and status does not alter the lock', async ({ cleanup }) => {
  const f = await fixture(cleanup)
  await mkdir(f.lock, { recursive: true })
  await writeFile(path.join(f.lock, 'owner'), `${process.pid}\n`)
  const child = run(f)
  const output = await owned(child, cleanup)
  const result = await collectExit(child, output)
  assert.equal(result.code, 2, result.text)
  assert.match(result.text, /cluster lock busy/)
  assert.equal(await readFile(path.join(f.lock, 'owner'), 'utf8'), `${process.pid}\n`)
  assert.equal(await readFile(f.statusLog, 'utf8'), '')
  const status = spawn('bash', [path.join(f.root, 'bin/pg.sh'), 'status'], {
    cwd: f.root,
    env: f.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const statusOutput = await owned(status, cleanup)
  const statusResult = await collectExit(status, statusOutput)
  assert.equal(statusResult.code, 3, statusResult.text)
  assert.match(statusResult.text, /owned cluster stopped/)
  assert.equal(await readFile(path.join(f.lock, 'owner'), 'utf8'), `${process.pid}\n`)
})

test('a stale reclaimer cannot remove a replacement owner', async ({ cleanup }) => {
  const f = await fixture(cleanup)
  await mkdir(f.lock, { recursive: true })
  const dead = spawnSync(process.execPath, ['-e', ''], { env: f.env })
  assert.ok(dead.pid)
  await writeFile(path.join(f.lock, 'owner'), `${dead.pid}\n`)
  const marker = path.join(f.root, 'unlink.ready')
  const gate = path.join(f.root, 'unlink.gate')
  const hook = path.join(f.root, 'unlink-hook.cjs')
  await writeFile(gate, '')
  await writeFile(
    hook,
    `
const fs = require('node:fs')
const original = fs.unlinkSync
fs.unlinkSync = (name) => {
  if (name === 'owner' && process.argv[2] === 'acquire') {
    fs.writeFileSync(${JSON.stringify(marker)}, 'ready')
    while (fs.existsSync(${JSON.stringify(gate)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  }
  return original(name)
}
`
  )
  const a = run(f, { ...f.env, NODE_OPTIONS: `--require=${hook}` })
  const aOutput = await owned(a, cleanup)
  await waitForFile(marker)
  await writeFile(f.statusGate, '')
  const b = run(f)
  const bOutput = await owned(b, cleanup)
  await waitForFile(f.statusReady)
  const bPid = b.pid!
  assert.equal(await readFile(path.join(f.lock, 'owner'), 'utf8'), `${bPid}\n`)
  const firstGeneration = await stat(f.lock)
  const generation = firstGeneration.ino
  await rm(gate)
  const aResult = await collectExit(a, aOutput)
  assert.equal(aResult.code, 2, aResult.text)
  assert.equal(await readFile(path.join(f.lock, 'owner'), 'utf8'), `${bPid}\n`)
  const currentGeneration = await stat(f.lock)
  assert.equal(currentGeneration.ino, generation)
  assert.equal(await readFile(f.statusLog, 'utf8'), 'status\n')
  await rm(f.statusGate)
  const bResult = await collectExit(b, bOutput)
  assert.equal(bResult.code, 0, bResult.text)
})

test('interrupted publication never exposes an incomplete owner', async ({ cleanup }) => {
  const f = await fixture(cleanup)
  const marker = path.join(f.root, 'rename.ready')
  const gate = path.join(f.root, 'rename.gate')
  const hook = path.join(f.root, 'rename-hook.cjs')
  await writeFile(gate, '')
  await writeFile(
    hook,
    `
const fs = require('node:fs')
const original = fs.renameSync
fs.renameSync = (source, destination) => {
  if (destination.endsWith('pg16.lock') && process.argv[2] === 'acquire') {
    fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid))
    while (fs.existsSync(${JSON.stringify(gate)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  }
  return original(source, destination)
}
`
  )
  const child = run(f, { ...f.env, NODE_OPTIONS: `--require=${hook}` })
  const output = await owned(child, cleanup)
  const helperPid = Number(await waitForFile(marker))
  const beforeEntries = await readdir(path.join(f.root, 'tmp'))
  const temporary = beforeEntries.filter((name) => name.startsWith('pg16.lock.candidate-'))
  assert.equal(temporary.length, 1)
  assert.equal(
    await readFile(path.join(f.root, 'tmp', temporary[0], 'owner'), 'utf8'),
    `${child.pid}\n`
  )
  assert.equal(beforeEntries.includes('pg16.lock'), false)
  child.kill('SIGKILL')
  process.kill(helperPid, 'SIGKILL')
  await rm(gate)
  await collectExit(child, output)
  const next = run(f)
  const nextOutput = await owned(next, cleanup)
  const result = await collectExit(next, nextOutput)
  assert.equal(result.code, 0, result.text)
  assert.equal(await readFile(f.statusLog, 'utf8'), 'status\n')
}).timeout(10_000)
