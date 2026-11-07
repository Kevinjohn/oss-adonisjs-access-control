import vine from '@vinejs/vine'
import { accountMessages, email, password } from '#validators/user'

/** Roles a team admin may invite to. The owner role moves only by transfer. */
export const invitableRoles = ['viewer', 'editor', 'admin'] as const

export const teamValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(100),
})

export const teamInvitationValidator = vine.create({
  email: email(),
  role: vine.enum(invitableRoles),
})
teamInvitationValidator.messagesProvider = accountMessages

export const acceptInvitationValidator = vine.create({
  fullName: vine.string().trim().maxLength(255).optional(),
  password: password(),
  passwordConfirmation: password().sameAs('password'),
})
acceptInvitationValidator.messagesProvider = accountMessages
