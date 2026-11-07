import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { transaction } from '@kevinjohn/adonisjs-account-kit/transaction'
import accessControl from '#config/access_control'
import Team from '#models/team'
import { teamValidator } from '#validators/account_kit'

/** Teams: Access Control memberships scope every route under `/teams/:scopeId`. */
export default class TeamsController {
  /** Creates the team and makes the caller its owner, in one transaction. */
  async store({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const { name } = await request.validateUsing(teamValidator)
    const team = await transaction(db, async (trx) => {
      const created = await Team.create({ name }, { client: trx })
      await accessControl.memberships.createFirstMember({
        scopeId: created.id,
        userId: user.id,
        trx,
      })
      return created
    })
    return response.created({ id: team.id, name: team.name })
  }

  /** Any member: `team:read` is the viewer role and above. */
  async show({ bouncer, membership, params, response }: HttpContext) {
    await bouncer.authorize('team:read')
    const team = await Team.findOrFail(params.scopeId)
    return response.ok({
      id: team.id,
      name: team.name,
      membership: accessControl.clientPayload(membership),
    })
  }

  /** Renaming needs `team:write`: editors and above. */
  async update({ bouncer, params, request, response }: HttpContext) {
    await bouncer.authorize('team:write')
    const { name } = await request.validateUsing(teamValidator)
    const team = await Team.findOrFail(params.scopeId)
    team.name = name
    await team.save()
    return response.ok({ id: team.id, name: team.name })
  }
}
