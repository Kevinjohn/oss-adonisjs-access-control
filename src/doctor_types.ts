import type { Database } from '@adonisjs/lucid/database'
import type { AccessControl } from './define.ts'

/** One doctor check: `ok` when `count` is zero; `sampleIds` holds up to 20 row ids. */
export interface DoctorCheck {
  name: string
  ok: boolean
  count: number
  /** Up to 20 ids of the rows found; for `memberships_table`, the missing column names. */
  sampleIds: string[]
}

/** The doctor result, printed as JSON with `--json`. */
export interface DoctorReport {
  checks: DoctorCheck[]
}

/** Input of `runDoctor`. */
export interface DoctorInput {
  access: AccessControl
  db: Database
  /** Restrict the row checks to one scope. */
  scope?: unknown
  /** The installed and expected Account Kit versions; omitted to skip the version check. */
  accountKit?: { installed: string | null; expected: string }
}
