import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import type { AccessControlErrorCode } from './types.js'

/** Shared HTTP handling for the package's concrete exceptions. */
abstract class AccessControlException extends Exception {
  declare code: AccessControlErrorCode

  constructor(detail?: string, options?: ErrorOptions) {
    super(detail, { cause: options?.cause })
    this.message = detail ?? this.message
  }

  /**
   * Sends the exception's status, `Cache-Control: no-store` and `{ errors: [{ code, message }] }`.
   * The message is `ctx.i18n.t('errors.<code>', {}, <English>)` when `ctx.i18n` exists.
   */
  async handle(error: this, ctx: HttpContext): Promise<void> {
    const i18n = (ctx as { i18n?: Translator }).i18n
    const message = i18n ? i18n.t(`errors.${error.code}`, {}, error.message) : error.message
    ctx.response
      .status(error.status)
      .header('Cache-Control', 'no-store')
      .json({ errors: [{ code: error.code, message }] })
  }
}

/** The slice of `@adonisjs/i18n`'s translator the error handler uses. */
interface Translator {
  t(key: string, data: Record<string, unknown>, fallback: string): string
}

/** You do not have permission to do that. */
class ForbiddenException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_FORBIDDEN'
  static status = 403
  static message = 'You do not have permission to do that.'
}

/** The 403 exception for forbidden. */
export const E_ACCESS_CONTROL_FORBIDDEN = ForbiddenException

/** That person is not a member of this team. */
class NotAMemberException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_NOT_A_MEMBER'
  static status = 404
  static message = 'That person is not a member of this team.'
}

/** The 404 exception for not a member. */
export const E_ACCESS_CONTROL_NOT_A_MEMBER = NotAMemberException

/** That person does not exist. */
class UserNotFoundException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_USER_NOT_FOUND'
  static status = 404
  static message = 'That person does not exist.'
}

/** The 404 exception for user not found. */
export const E_ACCESS_CONTROL_USER_NOT_FOUND = UserNotFoundException

/** That person is already a member of this team. */
class AlreadyMemberException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_ALREADY_MEMBER'
  static status = 409
  static message = 'That person is already a member of this team.'
}

/** The 409 exception for already member. */
export const E_ACCESS_CONTROL_ALREADY_MEMBER = AlreadyMemberException

/** That role does not exist. */
class UnknownRoleException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_UNKNOWN_ROLE'
  static status = 422
  static message = 'That role does not exist.'
}

/** The 422 exception for unknown role. */
export const E_ACCESS_CONTROL_UNKNOWN_ROLE = UnknownRoleException

/** You cannot manage someone with a higher role. */
class RankTooLowException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_RANK_TOO_LOW'
  static status = 403
  static message = 'You cannot manage someone with a higher role.'
}

/** The 403 exception for rank too low. */
export const E_ACCESS_CONTROL_RANK_TOO_LOW = RankTooLowException

/** The owner cannot be changed, suspended or removed except through an ownership transfer. */
class OwnerProtectedException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_OWNER_PROTECTED'
  static status = 409
  static message =
    'The owner cannot be changed, suspended or removed except through an ownership transfer.'
}

/** The 409 exception for owner protected. */
export const E_ACCESS_CONTROL_OWNER_PROTECTED = OwnerProtectedException

/** You cannot change your own role or status. */
class SelfManagementException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_SELF_MANAGEMENT'
  static status = 409
  static message = 'You cannot change your own role or status.'
}

/** The 409 exception for self management. */
export const E_ACCESS_CONTROL_SELF_MANAGEMENT = SelfManagementException

/** This application has no owner role. */
class OwnerDisabledException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_OWNER_DISABLED'
  static status = 409
  static message = 'This application has no owner role.'
}

/** The 409 exception for owner disabled. */
export const E_ACCESS_CONTROL_OWNER_DISABLED = OwnerDisabledException

/** Transfer ownership before deleting this account. */
class LastOwnerException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_LAST_OWNER'
  static status = 409
  static message = 'Transfer ownership before deleting this account.'
}

/** The 409 exception for last owner. */
export const E_ACCESS_CONTROL_LAST_OWNER = LastOwnerException

/** This team already has members. */
class ScopeNotEmptyException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_SCOPE_NOT_EMPTY'
  static status = 409
  static message = 'This team already has members.'
}

/** The 409 exception for scope not empty. */
export const E_ACCESS_CONTROL_SCOPE_NOT_EMPTY = ScopeNotEmptyException

/** That team does not exist. */
class ScopeNotFoundException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_SCOPE_NOT_FOUND'
  static status = 404
  static message = 'That team does not exist.'
}

/** The 404 exception for scope not found. */
export const E_ACCESS_CONTROL_SCOPE_NOT_FOUND = ScopeNotFoundException

/** The request is not valid. */
class InvalidInputException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_INVALID_INPUT'
  static status = 422
  static message = 'The request is not valid.'
}

/** The 422 exception for invalid input. */
export const E_ACCESS_CONTROL_INVALID_INPUT = InvalidInputException

/** The access-control configuration is not valid. */
class InvalidConfigException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_INVALID_CONFIG'
  static status = 500
  static message = 'The access-control configuration is not valid.'
}

/** The 500 exception for invalid config. */
export const E_ACCESS_CONTROL_INVALID_CONFIG = InvalidConfigException

/** The team changed while it was being deleted. Try again. */
class ConflictException extends AccessControlException {
  static code = 'E_ACCESS_CONTROL_CONFLICT'
  static status = 409
  static message = 'The team changed while it was being deleted. Try again.'
}

/** The 409 exception for conflict. */
export const E_ACCESS_CONTROL_CONFLICT = ConflictException
