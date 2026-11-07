import type { HttpContext } from '@adonisjs/core/http'
import kit from '@kevinjohn/adonisjs-account-kit/services/main'
import { errors } from '@kevinjohn/adonisjs-account-kit'
import { isDeliveryFailure } from '#services/delivery_failure'
import { sendTokenPageHeaders } from '#services/token_page_headers'
import { acceptInvitationValidator } from '#validators/team'

/** The invitation link: choose a password to create the account and join the team. */
export default class InvitationsController {
  async edit(ctx: HttpContext) {
    sendTokenPageHeaders(ctx.response)
    const invitation = await kit.invitations.inspect({ token: ctx.params.token })
    return ctx.view.render('pages/auth/accept_invitation', {
      token: ctx.params.token,
      email: invitation?.email,
    })
  }

  async update(ctx: HttpContext) {
    sendTokenPageHeaders(ctx.response)
    const { fullName, password } = await ctx.request.validateUsing(acceptInvitationValidator)
    try {
      await kit.invitations.accept({
        token: ctx.params.token,
        password,
        registrationData: { fullName },
      })
    } catch (error) {
      if (error instanceof errors.InvalidTokenError) {
        ctx.session.flash('error', 'This invitation is invalid, already used, or expired.')
        return ctx.response.redirect().withQs(false).toRoute('session.create')
      }
      if (!isDeliveryFailure(error)) throw error
      ctx.logger.error(
        { event: 'invitation_follow_up_failed' },
        'Acceptance committed but a follow-up failed'
      )
    }
    ctx.session.flash('success', 'Your account is ready. Sign in to open your team.')
    return ctx.response.redirect().withQs(false).toRoute('session.create')
  }
}
