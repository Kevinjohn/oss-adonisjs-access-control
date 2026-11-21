import { RuntimeException } from '@adonisjs/core/exceptions'

/** Plan new files without changing the names of existing migrations. A missing predecessor
 * cannot safely be appended after an already-published successor. */
export function planMigrations(files: string[], released: string[], now = Date.now()) {
  const existing = files.filter((file) => /\.([cm]?ts|[cm]?js)$/.test(file))
  const prefixOf = (filename: string) => BigInt(/^(\d+)_/.exec(filename)?.[1] ?? '0')
  let timestamp = BigInt(now) - 1n
  for (const filename of existing) {
    const prefix = /^(\d+)_/.exec(filename)?.[1]
    if (prefix && BigInt(prefix) > timestamp) timestamp = BigInt(prefix)
  }
  const plan: { name: string; filename: string; existing: boolean }[] = []
  let missing = false
  let previous: string | undefined
  const unsafe = () =>
    new RuntimeException(
      'access-control: migration history cannot be ordered safely; review the existing migration names and repair the prerequisite order manually before rerunning configure. Do not rename applied migrations.'
    )
  for (const name of released) {
    const suffix = `_${name}.ts`
    const matches = existing.filter((file) => file.endsWith(suffix))
    if (matches.length > 1) throw unsafe()
    const found = matches[0]
    if (found) {
      if (
        missing ||
        (previous !== undefined && (found <= previous || prefixOf(found) < prefixOf(previous)))
      )
        throw unsafe()
      plan.push({ name, filename: found, existing: true })
      previous = found
      continue
    }
    missing = true
    const filename = `${++timestamp}${suffix}`
    // Lucid also supports lexicographic filename sorting. Refuse non-conventional numeric
    // prefixes which would place a generated prerequisite before an existing migration.
    if (
      existing.some((file) => /^\d+_/.test(file) && file >= filename) ||
      (previous !== undefined && filename <= previous)
    )
      throw unsafe()
    plan.push({ name, filename, existing: false })
  }
  return plan
}
