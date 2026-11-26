// `node ace access-control:doctor`: read-only consistency checks (specification 17.2).
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RuntimeException } from '@adonisjs/core/exceptions'
import type { Database } from '@adonisjs/lucid/database'
import { requireValidKey } from './keys.ts'
import { readTimestamp } from './kit_transaction.ts'
import { inspectMembershipConstraints } from './membership_constraints.ts'
import { readPackageManifest } from './package_root.ts'
import { resolveStoredParentId } from './stored_keys.ts'

import type { DoctorCheck, DoctorInput, DoctorReport } from './doctor_types.ts'

const sampleLimit = 20
const timestampBatchSize = 1000

/** Whether a stored timestamp is one the membership reads accept: present and readable. */
function isReadableTimestamp(value: unknown): boolean {
  try {
    return readTimestamp(value)?.isValid === true
  } catch {
    return false
  }
}
const expectedColumns = ['id', 'scope_id', 'user_id', 'role', 'status', 'created_at', 'updated_at']

function buildDoctorCheck(name: string, ids: unknown[], findingCount = ids.length): DoctorCheck {
  return {
    name,
    ok: findingCount === 0,
    count: findingCount,
    sampleIds: ids.slice(0, sampleLimit).map(String),
  }
}

async function countMatchingRows(query: ReturnType<Database['from']>): Promise<number> {
  const [row] = await query.clone().clearSelect().clearOrder().count('* as total')
  return Number((row as { total: unknown }).total)
}

/** Runs the checks without writing or locking. Throws when a check cannot run. */
export async function runDoctor(input: DoctorInput): Promise<DoctorReport> {
  const { access, db } = input
  const { membershipsTable, users, scope: scopeConfig, roles, ownerRole } = access.config
  // A fresh schema builder per call: knex queues statements on a reused builder.
  const createSchemaBuilder = () => db.connection().schema
  const checks: DoctorCheck[] = []

  if (!(await createSchemaBuilder().hasTable(membershipsTable))) {
    checks.push({ name: 'memberships_table', ok: false, count: 1, sampleIds: [] })
    return { checks: [...checks, ...(await checkAccountKitVersion(input))] }
  }
  const missing: string[] = []
  for (const column of expectedColumns)
    if (!(await createSchemaBuilder().hasColumn(membershipsTable, column))) missing.push(column)
  checks.push(buildDoctorCheck('memberships_table', missing))
  if (missing.length > 0) return { checks: [...checks, ...(await checkAccountKitVersion(input))] }

  const constraints = await inspectMembershipConstraints(db.connection(), {
    table: membershipsTable,
    scopeTable: scopeConfig.table,
    usersTable: users.table,
  })
  checks.push(
    buildDoctorCheck('memberships_unique_scope_user', [], constraints.hasUniquePair ? 0 : 1),
    buildDoctorCheck('memberships_scope_foreign_key', [], constraints.hasScopeReference ? 0 : 1),
    buildDoctorCheck('memberships_user_foreign_key', [], constraints.hasUserReference ? 0 : 1)
  )

  const scopeId =
    input.scope === undefined
      ? undefined
      : await resolveStoredParentId(
          db.connection(),
          scopeConfig.table,
          scopeConfig.keyType,
          requireValidKey(scopeConfig.keyType, input.scope, 'scope')
        )
  const buildMembershipQuery = () => {
    const query = db.from(`${membershipsTable} as m`)
    return scopeId === undefined ? query : query.where('m.scope_id', scopeId)
  }
  const listSampleIds = async (query: ReturnType<Database['from']>) => {
    const found = await query.clone().select('m.id').orderBy('m.id', 'asc').limit(sampleLimit)
    return found.map((row) => row.id)
  }
  // The runtime compares roles and statuses as exact strings; MySQL's default collation does
  // not, so `EDITOR` would pass `NOT IN ('editor', ...)` there and be refused at runtime.
  const formatExactColumn = (column: string) =>
    db.connection().dialect.name === 'mysql' ? `binary ${column}` : column
  const buildExcludedValueQuery = (column: string, values: string[]) =>
    buildMembershipQuery().where((query) =>
      query
        .whereNull(column)
        .orWhereRaw(
          `${formatExactColumn(column)} not in (${values.map(() => '?').join(', ')})`,
          values
        )
    )

  const unknownRole = buildExcludedValueQuery('m.role', [...roles])
  checks.push(
    buildDoctorCheck(
      'unknown_role',
      await listSampleIds(unknownRole),
      await countMatchingRows(unknownRole)
    )
  )
  const unknownStatus = buildExcludedValueQuery('m.status', ['active', 'suspended'])
  checks.push(
    buildDoctorCheck(
      'unknown_status',
      await listSampleIds(unknownStatus),
      await countMatchingRows(unknownStatus)
    )
  )

  // Reads refuse a NULL or unreadable timestamp. Values are read with the same reader as the
  // membership service, in id order and in batches, because engines disagree on what a timestamp
  // column may hold.
  const invalidTimestampIds: unknown[] = []
  let invalidTimestampCount = 0
  let lastId: unknown
  for (;;) {
    const query = buildMembershipQuery()
      .select('m.id', 'm.created_at', 'm.updated_at')
      .orderBy('m.id', 'asc')
      .limit(timestampBatchSize)
    if (lastId !== undefined) query.where('m.id', '>', lastId as string | number)
    const batch = await query
    for (const row of batch) {
      if (isReadableTimestamp(row.created_at) && isReadableTimestamp(row.updated_at)) continue
      invalidTimestampCount++
      if (invalidTimestampIds.length < sampleLimit) invalidTimestampIds.push(row.id)
    }
    if (batch.length < timestampBatchSize) break
    lastId = batch[batch.length - 1].id
  }
  checks.push(buildDoctorCheck('invalid_timestamp', invalidTimestampIds, invalidTimestampCount))

  if (ownerRole !== undefined) {
    const queryOwnerCounts = (comparison: '=' | '>') =>
      buildMembershipQuery()
        .select('m.scope_id')
        .select(db.raw('count(*) over() as total'))
        .groupBy('m.scope_id')
        .havingRaw(
          `sum(case when ${formatExactColumn('m.role')} = ? and ${formatExactColumn('m.status')} = 'active' then 1 else 0 end) ${comparison} ?`,
          [ownerRole, comparison === '=' ? 0 : 1]
        )
        .orderBy('m.scope_id', 'asc')
        .limit(sampleLimit)
    const [without, many] = await Promise.all([queryOwnerCounts('='), queryOwnerCounts('>')])
    checks.push(
      buildDoctorCheck(
        'scope_without_owner',
        without.map((row) => row.scope_id),
        Number(without[0]?.total ?? 0)
      )
    )
    checks.push(
      buildDoctorCheck(
        'scope_with_many_owners',
        many.map((row) => row.scope_id),
        Number(many[0]?.total ?? 0)
      )
    )
  }

  const orphanScope = buildMembershipQuery()
    .leftJoin(`${scopeConfig.table} as s`, 'm.scope_id', 's.id')
    .whereNull('s.id')
  checks.push(
    buildDoctorCheck(
      'orphan_scope',
      await listSampleIds(orphanScope),
      await countMatchingRows(orphanScope)
    )
  )
  const orphanUser = buildMembershipQuery()
    .leftJoin(`${users.table} as u`, 'm.user_id', 'u.id')
    .whereNull('u.id')
  checks.push(
    buildDoctorCheck(
      'orphan_user',
      await listSampleIds(orphanUser),
      await countMatchingRows(orphanUser)
    )
  )
  checks.push(...(await checkAccountKitVersion(input)))
  return { checks }
}

async function checkAccountKitVersion(input: DoctorInput): Promise<DoctorCheck[]> {
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

/**
 * The installed Account Kit version next to this package, and the exact version it expects.
 * `installed` is `null` when Account Kit is not installed, which the doctor reports as a mismatch.
 * A manifest that is installed but cannot be read, or has no version, throws: the check could not
 * run.
 */
export function readAccountKitVersions(
  resolve: (specifier: string) => string = (specifier) => import.meta.resolve(specifier)
): { installed: string | null; expected: string } {
  const here = dirname(fileURLToPath(import.meta.url))
  const own = readPackageManifest(here, '@kevinjohn/adonisjs-access-control')
  const expected = String(
    (own.peerDependencies as Record<string, string>)['@kevinjohn/adonisjs-account-kit']
  )
  let entry: string
  try {
    entry = fileURLToPath(resolve('@kevinjohn/adonisjs-account-kit'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      return { installed: null, expected }
    }
    throw error
  }
  const { version } = readPackageManifest(dirname(entry), '@kevinjohn/adonisjs-account-kit')
  if (typeof version !== 'string') {
    throw new RuntimeException('@kevinjohn/adonisjs-account-kit: installed manifest has no version')
  }
  return { installed: version, expected }
}
