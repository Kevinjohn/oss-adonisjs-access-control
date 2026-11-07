import vine from '@vinejs/vine'
import { email, optionalFullName } from '#validators/fields'
import { password } from '#validators/password'

export const recoveryRequestValidator = vine.create({ email: email() })
/** A new password and its confirmation, for password reset and email verification. */
export const passwordValidator = vine.create({
  password: password(),
  passwordConfirmation: vine.string().sameAs('password'),
})
export const invitationAcceptValidator = vine.create({
  password: password(),
  passwordConfirmation: vine.string().sameAs('password'),
  fullName: optionalFullName(),
})
// `scope` is the team id, spelled as Access Control normalises it: a plain integer.
const teamScope = () =>
  vine
    .string()
    .trim()
    .regex(/^[1-9]\d*$/)
export const invitationValidator = vine.create({
  email: email(),
  role: vine.string().trim().minLength(1),
  scope: teamScope(),
})
export const invitationListValidator = vine.create({
  scope: teamScope(),
  limit: vine.number().min(1).max(100).optional(),
  cursor: vine.string().optional(),
})
export const teamValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(100),
})
export const credentialChangeValidator = vine.create({
  currentPassword: vine.string().minLength(1),
  newPassword: password(),
  newPasswordConfirmation: vine.string().sameAs('newPassword'),
})
export const profileUpdateValidator = vine.create({
  currentPassword: vine.string().minLength(1),
  email: email().optional(),
  fullName: optionalFullName(),
})
