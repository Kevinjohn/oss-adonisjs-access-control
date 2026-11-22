import { basename, dirname, extname, join } from 'node:path'
import { RuntimeException } from '@adonisjs/core/exceptions'

/** The refusal for one named cause; the migration history is left untouched. */
function unsafe(cause: string) {
  return new RuntimeException(
    `access-control: migration history cannot be ordered safely: ${cause}. Do not rename applied migrations. Repair the order manually, or pass --migration-path=<directory> to publish into a directory where the new migrations sort after every existing one, then rerun configure.`
  )
}

/** Plan new files without changing the names of existing migrations. A missing predecessor
 * cannot safely be appended after an already-published successor. New files go beside the
 * last released migration already present, so a nested history stays together. */
export function planMigrations(files: string[], released: string[], now = Date.now()) {
  const existing = files.filter((file) => /\.([cm]?ts|[cm]?js)$/.test(file))
  const before = (left: string, right: string) =>
    left < right && left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }) < 0
  let timestamp = BigInt(now) - 1n
  for (const filename of existing) {
    const prefix = /^(\d+)_/.exec(basename(filename))?.[1]
    if (prefix && BigInt(prefix) > timestamp) timestamp = BigInt(prefix)
  }
  const plan: { name: string; filename: string; existing: boolean }[] = []
  let missing: string | undefined
  let previous: string | undefined
  for (const name of released) {
    const suffix = `_${name}.ts`
    const matches = existing.filter((file) => basename(file, extname(file)).endsWith(`_${name}`))
    if (matches.length > 1)
      throw unsafe(`${matches.join(' and ')} both publish the released migration ${name}`)
    const found = matches[0]
    if (found) {
      if (missing !== undefined)
        throw unsafe(`${found} exists but the released migration ${missing} it depends on does not`)
      if (previous !== undefined && !before(previous, found))
        throw unsafe(`${found} sorts before ${previous}, which it depends on`)
      plan.push({ name, filename: found, existing: true })
      previous = found
      continue
    }
    missing ??= name
    const filename = join(
      previous === undefined ? '.' : dirname(previous),
      `${++timestamp}${suffix}`
    )
    // Lucid also supports lexicographic filename sorting. Refuse when an existing migration
    // would run after the generated prerequisite.
    const later = existing.find((file) => !before(file, filename))
    if (later !== undefined) throw unsafe(`${later} sorts after the new ${filename}`)
    if (previous !== undefined && !before(previous, filename))
      throw unsafe(`${previous} sorts after the new ${filename}`)
    plan.push({ name, filename, existing: false })
  }
  return plan
}
