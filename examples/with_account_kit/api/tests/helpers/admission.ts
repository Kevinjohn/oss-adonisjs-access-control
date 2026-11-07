import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { transaction } from '@kevinjohn/adonisjs-account-kit/transaction'
import accessControl from '#config/access_control'
import Team from '#models/team'

type Person = { id: number | string; email: string }

/** Record operator invitation evidence and an approval, so the user is admitted. */
export async function grantAdmission(user: Person) {
  const now = DateTime.utc().toJSDate()
  await db.table('account_admissions').insert({
    user_id: user.id,
    invited_email: user.email,
    invitation_source: 'operator',
    invitation_recorded_at: now,
    approval_status: 'approved',
    approval_decided_at: now,
    created_at: now,
    updated_at: now,
  })
}

/**
 * Give the user the instance owner role, admission and a team they own, as the bootstrap of a
 * first owner would. Admission decisions need the owner role; invitations need the team.
 * Returns the team's id as the invitation `scope`.
 */
export async function grantAdmittedOwner(user: Person) {
  await db.table('role_assignments').insert({ user_id: user.id, role: 'owner' })
  await grantAdmission(user)
  return createOwnedTeam(user)
}

/** A team the user owns, through Access Control. Returns its id as the invitation `scope`. */
export async function createOwnedTeam(user: Person, name = 'Example team') {
  const team = await transaction(db, async (trx) => {
    const created = await Team.create({ name }, { client: trx })
    await accessControl.memberships.createFirstMember({ scopeId: created.id, userId: user.id, trx })
    return created
  })
  return String(team.id)
}
