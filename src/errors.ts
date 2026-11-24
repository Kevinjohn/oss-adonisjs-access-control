import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import type { AccessControlErrorCode } from './types.js'

/** Shared HTTP handling for the package's concrete exceptions. */
abstract class AccessControlException extends Exception {
  declare code: AccessControlErrorCode
  #concealedResponse?: 'access' | 'scope-existence'

  /** @internal Preserve the raw failure while hiding scope and membership existence on the wire. */
  concealScopeFailure(response: 'access' | 'scope-existence'): this {
    this.#concealedResponse = response
    return this
  }

  constructor(detail?: string, options?: ErrorOptions) {
    super(detail, { cause: options?.cause })
    this.message = detail ?? this.message
  }

  /**
   * The status, code and English fallback this exception sends over HTTP.
   *
   * @example
   * ```ts
   * const { code, status } = error.getHttpResponse()
   * ```
   */
  getHttpResponse(): {
    code: AccessControlErrorCode | 'E_ACCESS_CONTROL_FORBIDDEN'
    status: number
    message: string
  } {
    // A shared response prevents callers from probing memberships or scope existence.
    const { code, status, message } = this.#concealedResponse
      ? concealedResponses[this.#concealedResponse]
      : this
    return { code, status, message }
  }

  /**
   * Sends the exception's status, `Cache-Control: no-store` and `{ errors: [{ code, message }] }`.
   * The message is `ctx.i18n.t('errors.<code>', {}, <English>)` when `ctx.i18n` exists.
   */
  async handle(error: this, ctx: HttpContext): Promise<void> {
    const { code, status, message: fallback } = error.getHttpResponse()
    const i18n = (ctx as { i18n?: Translator }).i18n
    const message = i18n ? i18n.t(`errors.${code}`, {}, fallback) : fallback
    ctx.response
      .status(status)
      .header('Cache-Control', 'no-store')
      .json({ errors: [{ code, message }] })
  }
}

/** The slice of `@adonisjs/i18n`'s translator the error handler uses. */
interface Translator {
  t(key: string, data: Record<string, unknown>, fallback: string): string
}

/** That person is not a member of this team. */
class NotAMemberException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_NOT_A_MEMBER'
  static status = 404
  static message = 'That person is not a member of this team.'
}

/** The 404 exception for not a member. */
export const E_ACCESS_CONTROL_NOT_A_MEMBER = NotAMemberException

/** That person does not exist. */
class UserNotFoundException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_USER_NOT_FOUND'
  static status = 404
  static message = 'That person does not exist.'
}

/** The 404 exception for user not found. */
export const E_ACCESS_CONTROL_USER_NOT_FOUND = UserNotFoundException

/** That person is already a member of this team. */
class AlreadyMemberException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_ALREADY_MEMBER'
  static status = 409
  static message = 'That person is already a member of this team.'
}

/** The 409 exception for already member. */
export const E_ACCESS_CONTROL_ALREADY_MEMBER = AlreadyMemberException

/** That role does not exist. */
class UnknownRoleException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_UNKNOWN_ROLE'
  static status = 422
  static message = 'That role does not exist.'
}

/** The 422 exception for unknown role. */
export const E_ACCESS_CONTROL_UNKNOWN_ROLE = UnknownRoleException

/** You cannot manage someone with a higher role. */
class RankTooLowException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_RANK_TOO_LOW'
  static status = 403
  static message = 'You cannot manage someone with a higher role.'
}

/** The 403 exception for rank too low. */
export const E_ACCESS_CONTROL_RANK_TOO_LOW = RankTooLowException

/** The owner cannot be changed, suspended or removed except through an ownership transfer. */
class OwnerProtectedException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_OWNER_PROTECTED'
  static status = 409
  static message =
    'The owner cannot be changed, suspended or removed except through an ownership transfer.'
}

/** The 409 exception for owner protected. */
export const E_ACCESS_CONTROL_OWNER_PROTECTED = OwnerProtectedException

/** You cannot change your own role or status. */
class SelfManagementException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_SELF_MANAGEMENT'
  static status = 409
  static message = 'You cannot change your own role or status.'
}

/** The 409 exception for self management. */
export const E_ACCESS_CONTROL_SELF_MANAGEMENT = SelfManagementException

/** This application has no owner role. */
class OwnerDisabledException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_OWNER_DISABLED'
  static status = 409
  static message = 'This application has no owner role.'
}

/** The 409 exception for owner disabled. */
export const E_ACCESS_CONTROL_OWNER_DISABLED = OwnerDisabledException

/** Transfer ownership before deleting this account. */
class LastOwnerException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_LAST_OWNER'
  static status = 409
  static message = 'Transfer ownership before deleting this account.'
}

/** The 409 exception for last owner. */
export const E_ACCESS_CONTROL_LAST_OWNER = LastOwnerException

/** This team already has members. */
class ScopeNotEmptyException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_SCOPE_NOT_EMPTY'
  static status = 409
  static message = 'This team already has members.'
}

/** The 409 exception for scope not empty. */
export const E_ACCESS_CONTROL_SCOPE_NOT_EMPTY = ScopeNotEmptyException

/** That team does not exist. */
class ScopeNotFoundException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_SCOPE_NOT_FOUND'
  static status = 404
  static message = 'That team does not exist.'
}

/** The 404 exception for scope not found. */
export const E_ACCESS_CONTROL_SCOPE_NOT_FOUND = ScopeNotFoundException

/** The team changed while it was being deleted. Try again. */
class ConflictException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_CONFLICT'
  static status = 409
  static message = 'The team changed while it was being deleted. Try again.'
}

/** The 409 exception for conflict. */
export const E_ACCESS_CONTROL_CONFLICT = ConflictException

const concealedResponses = {
  'access': {
    code: 'E_ACCESS_CONTROL_FORBIDDEN',
    status: 403,
    message: 'You do not have permission to do that.',
  },
  'scope-existence': NotAMemberException,
} as const

class InvalidKeyException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_INVALID_KEY'
  static status = 422
  static message = 'The identifier is not valid.'
}

/** The identifier is not valid (422). */
export const E_ACCESS_CONTROL_INVALID_KEY = InvalidKeyException

class InvalidCursorException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_INVALID_CURSOR'
  static status = 422
  static message = 'Invalid membership cursor'
}

/** Invalid membership cursor (422). */
export const E_ACCESS_CONTROL_INVALID_CURSOR = InvalidCursorException

class InvalidPageLimitException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_INVALID_PAGE_LIMIT'
  static status = 422
  static message = 'access-control: limit must be an integer from 1 to 100'
}

/** access-control: limit must be an integer from 1 to 100 (422). */
export const E_ACCESS_CONTROL_INVALID_PAGE_LIMIT = InvalidPageLimitException

class InvalidMembershipStatusException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_INVALID_MEMBERSHIP_STATUS'
  static status = 422
  static message = 'access-control: status must be active or suspended'
}

/** access-control: status must be active or suspended (422). */
export const E_ACCESS_CONTROL_INVALID_MEMBERSHIP_STATUS = InvalidMembershipStatusException

class InvalidInvitationScopeException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_INVALID_INVITATION_SCOPE'
  static status = 422
  static message = 'The invitation scope must use the canonical spelling.'
}

/** The invitation scope must use the canonical spelling (422). */
export const E_ACCESS_CONTROL_INVALID_INVITATION_SCOPE = InvalidInvitationScopeException

class FirstMemberMustBeOwnerException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_FIRST_MEMBER_MUST_BE_OWNER'
  static status = 422
  static message = 'access-control: the first member takes the owner role'
}

/** access-control: the first member takes the owner role (422). */
export const E_ACCESS_CONTROL_FIRST_MEMBER_MUST_BE_OWNER = FirstMemberMustBeOwnerException

class FirstMemberRoleRequiredException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_FIRST_MEMBER_ROLE_REQUIRED'
  static status = 422
  static message = 'access-control: the first member needs a role with members:manage'
}

/** access-control: the first member needs a role with members:manage (422). */
export const E_ACCESS_CONTROL_FIRST_MEMBER_ROLE_REQUIRED = FirstMemberRoleRequiredException

class FirstMemberRoleCannotManageException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_FIRST_MEMBER_ROLE_CANNOT_MANAGE'
  static status = 422
  static message = 'access-control: the first member needs a role with members:manage'
}

/** access-control: the first member needs a role with members:manage (422). */
export const E_ACCESS_CONTROL_FIRST_MEMBER_ROLE_CANNOT_MANAGE = FirstMemberRoleCannotManageException

class OwnerRoleNotGrantableException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_OWNER_ROLE_NOT_GRANTABLE'
  static status = 422
  static message = 'The owner role cannot be granted directly or through an invitation.'
}

/** The owner role cannot be granted directly or through an invitation (422). */
export const E_ACCESS_CONTROL_OWNER_ROLE_NOT_GRANTABLE = OwnerRoleNotGrantableException

class OwnershipTargetSuspendedException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_OWNERSHIP_TARGET_SUSPENDED'
  static status = 422
  static message = 'access-control: ownership can only go to an active member'
}

/** access-control: ownership can only go to an active member (422). */
export const E_ACCESS_CONTROL_OWNERSHIP_TARGET_SUSPENDED = OwnershipTargetSuspendedException

class InvalidStoredRoleException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_INVALID_STORED_ROLE'
  static status = 500
  static message = 'access-control: stored membership has an invalid role'
}

/** access-control: stored membership has an invalid role (500). */
export const E_ACCESS_CONTROL_INVALID_STORED_ROLE = InvalidStoredRoleException

class InvalidStoredStatusException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_INVALID_STORED_STATUS'
  static status = 500
  static message = 'access-control: stored membership has an unsupported status'
}

/** access-control: stored membership has an unsupported status (500). */
export const E_ACCESS_CONTROL_INVALID_STORED_STATUS = InvalidStoredStatusException

class InvalidStoredTimestampException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_INVALID_STORED_TIMESTAMP'
  static status = 500
  static message = 'A stored membership timestamp is not valid.'
}

/** A stored membership timestamp is not valid (500). */
export const E_ACCESS_CONTROL_INVALID_STORED_TIMESTAMP = InvalidStoredTimestampException

class AuthenticationRequiredException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_AUTHENTICATION_REQUIRED'
  static status = 403
  static message = 'Authentication is required to enter this scope.'
}

/** Authentication is required to enter this scope (403). */
export const E_ACCESS_CONTROL_AUTHENTICATION_REQUIRED = AuthenticationRequiredException

class MembershipRequiredException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_MEMBERSHIP_REQUIRED'
  static status = 403
  static message = 'A membership is required to do that.'
}

/** A membership is required to do that (403). */
export const E_ACCESS_CONTROL_MEMBERSHIP_REQUIRED = MembershipRequiredException

class MembershipSuspendedException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_MEMBERSHIP_SUSPENDED'
  static status = 403
  static message = 'A suspended membership cannot do that.'
}

/** A suspended membership cannot do that (403). */
export const E_ACCESS_CONTROL_MEMBERSHIP_SUSPENDED = MembershipSuspendedException

class PermissionDeniedException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_PERMISSION_DENIED'
  static status = 403
  static message = 'You do not have permission to do that.'
}

/** You do not have permission to do that (403). */
export const E_ACCESS_CONTROL_PERMISSION_DENIED = PermissionDeniedException

class UnknownPermissionException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_UNKNOWN_PERMISSION'
  static status = 403
  static message = 'That permission does not exist.'
}

/** That permission does not exist (403). */
export const E_ACCESS_CONTROL_UNKNOWN_PERMISSION = UnknownPermissionException

class OwnerRequiredException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_OWNER_REQUIRED'
  static status = 403
  static message = 'Only the active owner can transfer ownership.'
}

/** Only the active owner can transfer ownership (403). */
export const E_ACCESS_CONTROL_OWNER_REQUIRED = OwnerRequiredException

class IdentityTargetHasNoMembershipsException extends AccessControlException {
  static readonly code = 'E_ACCESS_CONTROL_IDENTITY_TARGET_HAS_NO_MEMBERSHIPS'
  static status = 403
  static message = 'The target account has no memberships.'
}

/** The target account has no memberships (403). */
export const E_ACCESS_CONTROL_IDENTITY_TARGET_HAS_NO_MEMBERSHIPS =
  IdentityTargetHasNoMembershipsException
