import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageName = '@kevinjohn/adonisjs-access-control'

/** The directory holding this package's `package.json`, found by walking up from this module. */
function packageRoot(from: string): string {
  let directory = from
  for (;;) {
    const file = join(directory, 'package.json')
    if (existsSync(file)) {
      try {
        if (JSON.parse(readFileSync(file, 'utf8')).name === packageName) return directory
      } catch {
        // Not this package's manifest; keep walking.
      }
    }
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`${packageName}: package root not found from ${from}`)
    directory = parent
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const root = packageRoot(here)
const build = join(root, 'build')

/**
 * The package's stub directory, for `node ace configure`: `build/stubs` when running from the
 * built package and `stubs` when running from source. Computed from the package root rather than
 * from `import.meta.dirname`, because the bundler may place this module in a shared chunk.
 */
export const stubsRoot =
  here === build || here.startsWith(build + sep) ? join(build, 'stubs') : join(root, 'stubs')
