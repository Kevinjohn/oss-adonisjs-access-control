// #region copy_memberships
import { BaseSchema } from '@adonisjs/lucid/schema'
import type { Database } from '@adonisjs/lucid/database'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { sqlTimestamp } from '@kevinjohn/adonisjs-account-kit/transaction'

export async function copyMemberships(
  db: Database | QueryClientContract,
  source: string,
  destination: string
) {
  const now = sqlTimestamp(db)
  const old = await db.from(source).select('team_id', 'user_id', 'role', 'disabled')
  for (const row of old) {
    await db.table(destination).insert({
      scope_id: row.team_id,
      user_id: row.user_id,
      role: row.role === 'manager' ? 'admin' : row.role,
      status: row.disabled ? 'suspended' : 'active',
      created_at: now,
      updated_at: now,
    })
  }
}

export default class extends BaseSchema {
  async up() {
    this.defer((db) => copyMemberships(db, 'memberships', 'team_memberships'))
  }

  async down() {
    this.defer(async (db) => {
      await db.from('team_memberships').delete()
    })
  }
}
// #endregion copy_memberships
