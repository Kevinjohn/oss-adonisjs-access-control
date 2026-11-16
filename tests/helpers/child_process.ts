import type { ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'

/** Collect a child's stdout and stderr as it runs. */
export async function outputOf(child: ChildProcess): Promise<{
  text: () => string
  closed: Promise<[number | null, NodeJS.Signals | null]>
}> {
  let output = ''
  child.stdout!.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  child.stderr!.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  const closed = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    child.once('close', (code, signal) => resolve([code, signal]))
  })
  return { text: () => output, closed }
}

/** Wait for a child to exit and return its status with the output collected so far. */
export async function collectExit(
  _child: ChildProcess,
  output: { text: () => string; closed: Promise<[number | null, NodeJS.Signals | null]> }
): Promise<{ code: number | null; signal: NodeJS.Signals | null; text: string }> {
  const [code, signal] = await output.closed
  return { code, signal, text: output.text() }
}

/** Whether a process is still running; a zombie counts as gone. */
export async function isAlive(pid: number): Promise<boolean> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3)
    return state !== 'Z'
  } catch {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
  }
}

/** Poll for a file a child writes, such as a pid file. */
export async function waitForFile(filePath: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, 'utf8')
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

/** Wait for a complete, positive process ID written with a final newline. */
export async function waitForPidFile(filePath: string, timeoutMs = 5000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await readFile(filePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    if (/^[1-9]\d*\n$/.test(value)) {
      const pid = Number(value.trim())
      if (Number.isSafeInteger(pid) && pid <= 2_147_483_647) return pid
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for a complete process ID in ${filePath}`)
}
