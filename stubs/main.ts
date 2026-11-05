import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageRoot } from '../src/package_root.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = packageRoot(here, '@kevinjohn/adonisjs-access-control')
const build = join(root, 'build')

/**
 * The package's stub directory, for `node ace configure`: `build/stubs` when running from the
 * built package and `stubs` when running from source. Computed from the package root rather than
 * from `import.meta.dirname`, because the bundler may place this module in a shared chunk.
 */
export const stubsRoot =
  here === build || here.startsWith(build + sep) ? join(build, 'stubs') : join(root, 'stubs')
