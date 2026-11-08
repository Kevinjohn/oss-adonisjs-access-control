import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { transaction } from '@kevinjohn/adonisjs-account-kit/transaction'
import accessControl from '#config/access_control'
import Team from '#models/team'
import User from '#models/user'
import { invitableRoles, teamValidator } from '#validators/team'

/** Teams the signed-in account belongs to, and one team's page. */
export default class TeamsController {
  async index({ auth, inertia }: HttpContext) {
    const user = auth.getUserOrFail()
    const memberships = await accessControl.memberships.listForUser(user.id)
    const teams = await Team.query().whereIn(
      'id',
      memberships.map((membership) => membership.scopeId)
    )
    const roles = new Map(memberships.map((membership) => [membership.scopeId, membership.role]))
    return inertia.render('teams/index', {
      teams: teams.map((team) => ({
        id: team.id,
        name: team.name,
        role: roles.get(team.id) ?? '',
      })),
    })
  }

  /** Creates the team and makes the signed-in account its owner, in one transaction. */
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
    return response.redirect().toRoute('teams.show', { scopeId: team.id })
  }

  /** Behind `middleware.scope()`: only members reach it. */
  async show({ auth, bouncer, inertia, membership, params }: HttpContext) {
    const user = auth.getUserOrFail()
    await bouncer.authorize('team:read')
    const team = await Team.findOrFail(params.scopeId)
    const page = await accessControl.memberships.listForScope({
      actor: { id: user.id },
      scopeId: team.id,
      limit: 100,
    })
    const users = await User.query().whereIn(
      'id',
      page.items.map((item) => item.userId)
    )
    const emails = new Map(users.map((member) => [member.id, member.email]))
    return inertia.render('teams/show', {
      team: { id: team.id, name: team.name },
      role: membership?.role ?? '',
      members: page.items.map((item) => ({
        email: emails.get(Number(item.userId)) ?? '',
        role: item.role,
      })),
      canWrite: await bouncer.allows('team:write'),
      canInvite: await bouncer.allows('invitations:manage'),
      invitableRoles: [...invitableRoles],
    })
  }

  /** Renaming needs `team:write`: editors and above. */
  async update({ bouncer, params, request, response, session }: HttpContext) {
    await bouncer.authorize('team:write')
    const { name } = await request.validateUsing(teamValidator)
    const team = await Team.findOrFail(params.scopeId)
    team.name = name
    await team.save()
    session.flash('success', 'Team renamed.')
    return response.redirect().toRoute('teams.show', { scopeId: team.id })
  }
}
