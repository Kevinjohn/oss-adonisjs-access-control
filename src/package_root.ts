// Locates a package's root directory by walking up from a module path to its package.json.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { RuntimeException } from '@adonisjs/core/exceptions'

/** The directory holding the `package.json` of `packageName`, walking up from `from`. */
export function packageRoot(from: string, packageName: string): string {
  let directory = from
  for (;;) {
    const file = join(directory, 'package.json')
    if (existsSync(file)) {
      let name: unknown
      try {
        name = JSON.parse(readFileSync(file, 'utf8')).name
      } catch (cause) {
        // A manifest that cannot be read or parsed may be the one sought: never skip past it.
        throw new RuntimeException(`${packageName}: cannot read ${file}`, { cause })
      }
      if (name === packageName) return directory
    }
    const parent = dirname(directory)
    if (parent === directory)
      throw new RuntimeException(`${packageName}: package root not found from ${from}`)
    directory = parent
  }
}

/** The parsed `package.json` of `packageName`, walking up from `from`. */
export function packageManifest(from: string, packageName: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(packageRoot(from, packageName), 'package.json'), 'utf8'))
}
