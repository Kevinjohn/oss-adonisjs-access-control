import type { HttpContext } from '@adonisjs/core/http'
import kit from '@kevinjohn/adonisjs-account-kit/services/main'
import { isDeliveryFailure } from '#services/delivery_failure'
import { teamInvitationValidator } from '#validators/team'

/** Sends a team invitation. Access Control's callback decides who may invite to which role. */
export default class TeamInvitationsController {
  async store({ auth, logger, params, request, response, session }: HttpContext) {
    const actor = auth.getUserOrFail()
    const { email, role } = await request.validateUsing(teamInvitationValidator)
    try {
      await kit.invitations.send({ actorId: actor.id, email, role, scope: String(params.scopeId) })
    } catch (error) {
      if (!isDeliveryFailure(error)) throw error
      logger.error({ event: 'team_invitation_delivery_failed' }, 'Invitation could not be sent')
    }
    session.flash('success', `Invitation sent to ${email}.`)
    return response.redirect().toRoute('teams.show', { scopeId: params.scopeId })
  }
}
