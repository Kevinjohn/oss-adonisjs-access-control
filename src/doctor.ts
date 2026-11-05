// `node ace access-control:doctor`: read-only consistency checks (specification 17.2).
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Database } from '@adonisjs/lucid/database'
import type { AccessControl } from './define.js'
import { normaliseKey } from './keys.js'
import { packageManifest } from './package_root.js'

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

const sampleLimit = 20
const expectedColumns = ['id', 'scope_id', 'user_id', 'role', 'status', 'created_at', 'updated_at']

function check(name: string, ids: unknown[], count = ids.length): DoctorCheck {
  return { name, ok: count === 0, count, sampleIds: ids.slice(0, sampleLimit).map(String) }
}

async function countOf(query: ReturnType<Database['from']>): Promise<number> {
  const [row] = await query.clone().clearSelect().clearOrder().count('* as total')
  return Number((row as { total: unknown }).total)
}

/** Runs the checks without writing or locking. Throws when a check cannot run. */
export async function runDoctor(input: DoctorInput): Promise<DoctorReport> {
  const { access, db } = input
  const { membershipsTable, users, scope: scopeConfig, roles, ownerRole } = access.config
  // A fresh schema builder per call: knex queues statements on a reused builder.
  const schema = () => db.connection().schema
  const checks: DoctorCheck[] = []

  if (!(await schema().hasTable(membershipsTable))) {
    checks.push({ name: 'memberships_table', ok: false, count: 1, sampleIds: [] })
    return { checks: [...checks, ...(await accountKitCheck(input))] }
  }
  const missing: string[] = []
  for (const column of expectedColumns)
    if (!(await schema().hasColumn(membershipsTable, column))) missing.push(column)
  checks.push(check('memberships_table', missing))
  if (missing.length > 0) return { checks: [...checks, ...(await accountKitCheck(input))] }

  const scopeId =
    input.scope === undefined ? undefined : normaliseKey(scopeConfig.keyType, input.scope, 'scope')
  const rows = () => {
    const query = db.from(`${membershipsTable} as m`)
    return scopeId === undefined ? query : query.where('m.scope_id', scopeId)
  }
  const sampleIds = async (query: ReturnType<Database['from']>) => {
    const found = await query.clone().select('m.id').orderBy('m.id', 'asc').limit(sampleLimit)
    return found.map((row) => row.id)
  }

  const unknownRole = rows().whereNotIn('m.role', [...roles])
  checks.push(check('unknown_role', await sampleIds(unknownRole), await countOf(unknownRole)))
  const unknownStatus = rows().whereNotIn('m.status', ['active', 'suspended'])
  checks.push(check('unknown_status', await sampleIds(unknownStatus), await countOf(unknownStatus)))

  if (ownerRole !== undefined) {
    const owners = (comparison: '=' | '>') =>
      rows()
        .select('m.scope_id')
        .groupBy('m.scope_id')
        .havingRaw(
          `sum(case when m.role = ? and m.status = 'active' then 1 else 0 end) ${comparison} ?`,
          [ownerRole, comparison === '=' ? 0 : 1]
        )
        .orderBy('m.scope_id', 'asc')
    const [without, many] = await Promise.all([owners('='), owners('>')])
    checks.push(
      check(
        'scope_without_owner',
        without.map((row) => row.scope_id)
      )
    )
    checks.push(
      check(
        'scope_with_many_owners',
        many.map((row) => row.scope_id)
      )
    )
  }

  const orphanScope = rows()
    .leftJoin(`${scopeConfig.table} as s`, 'm.scope_id', 's.id')
    .whereNull('s.id')
  checks.push(check('orphan_scope', await sampleIds(orphanScope), await countOf(orphanScope)))
  const orphanUser = rows().leftJoin(`${users.table} as u`, 'm.user_id', 'u.id').whereNull('u.id')
  checks.push(check('orphan_user', await sampleIds(orphanUser), await countOf(orphanUser)))
  checks.push(...(await accountKitCheck(input)))
  return { checks }
}

async function accountKitCheck(input: DoctorInput): Promise<DoctorCheck[]> {
  if (input.accountKit === undefined) return []
  const { installed, expected } = input.accountKit
  return [
    {
      name: 'account_kit_version',
      ok: installed === expected,
      count: installed === expected ? 0 : 1,
      sampleIds: [],
    },
  ]
}

/** The installed Account Kit version next to this package, and the exact version it expects. */
export function accountKitVersions(): { installed: string | null; expected: string } {
  const here = dirname(fileURLToPath(import.meta.url))
  const own = packageManifest(here, '@kevinjohn/adonisjs-access-control')
  const expected = String(
    (own.peerDependencies as Record<string, string>)['@kevinjohn/adonisjs-account-kit']
  )
  let installed: string | null = null
  try {
    const entry = fileURLToPath(import.meta.resolve('@kevinjohn/adonisjs-account-kit'))
    installed = String(packageManifest(dirname(entry), '@kevinjohn/adonisjs-account-kit').version)
  } catch {
    installed = null
  }
  return { installed, expected }
}
