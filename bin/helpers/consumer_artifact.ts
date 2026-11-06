import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const fixtureArtifact = 'tmp/consumer-package.tgz'

export type PnpmCommand = (root: string, args: string[]) => void

const runPnpm: PnpmCommand = (root, args) => {
  execFileSync('pnpm', args, { cwd: root, stdio: 'inherit' })
}

/**
 * Returns the tarball the consumer harness installs. Without `--package` the package is rebuilt
 * and repacked first, and a failed build or pack stops the run, so an older tarball is never
 * tested in place of the current source. An explicit `--package` path is used as given.
 */
export function consumerArtifact(
  root: string,
  explicitPackage: string | undefined,
  pnpm: PnpmCommand = runPnpm
): string {
  if (explicitPackage !== undefined) return resolve(root, explicitPackage)
  mkdirSync(join(root, 'tmp'), { recursive: true })
  pnpm(root, ['build'])
  pnpm(root, ['pack', '--out', fixtureArtifact])
  return resolve(root, fixtureArtifact)
}
