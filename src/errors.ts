import { Exception } from '@adonisjs/core/exceptions'
import type { AccessControlErrorCode } from './types.js'

/** HTTP status and English fallback message per code (specification section 6). */
export const errorTable: Record<AccessControlErrorCode, { status: number; message: string }> = {
  E_ACCESS_CONTROL_FORBIDDEN: { status: 403, message: 'You do not have permission to do that.' },
  E_ACCESS_CONTROL_NOT_A_MEMBER: {
    status: 404,
    message: 'That person is not a member of this team.',
  },
  E_ACCESS_CONTROL_USER_NOT_FOUND: { status: 404, message: 'That person does not exist.' },
  E_ACCESS_CONTROL_ALREADY_MEMBER: {
    status: 409,
    message: 'That person is already a member of this team.',
  },
  E_ACCESS_CONTROL_UNKNOWN_ROLE: { status: 422, message: 'That role does not exist.' },
  E_ACCESS_CONTROL_RANK_TOO_LOW: {
    status: 403,
    message: 'You cannot manage someone with a higher role.',
  },
  E_ACCESS_CONTROL_OWNER_PROTECTED: {
    status: 409,
    message:
      'The owner cannot be changed, suspended or removed except through an ownership transfer.',
  },
  E_ACCESS_CONTROL_SELF_MANAGEMENT: {
    status: 409,
    message: 'You cannot change your own role or status.',
  },
  E_ACCESS_CONTROL_OWNER_DISABLED: { status: 409, message: 'This application has no owner role.' },
  E_ACCESS_CONTROL_LAST_OWNER: {
    status: 409,
    message: 'Transfer ownership before deleting this account.',
  },
  E_ACCESS_CONTROL_SCOPE_NOT_EMPTY: { status: 409, message: 'This team already has members.' },
  E_ACCESS_CONTROL_SCOPE_NOT_FOUND: { status: 404, message: 'That team does not exist.' },
  E_ACCESS_CONTROL_INVALID_INPUT: { status: 422, message: 'The request is not valid.' },
  E_ACCESS_CONTROL_INVALID_CONFIG: {
    status: 500,
    message: 'The access-control configuration is not valid.',
  },
  E_ACCESS_CONTROL_CONFLICT: {
    status: 409,
    message: 'The team changed while it was being deleted. Try again.',
  },
}

/**
 * The package error. `code` is one of the `E_ACCESS_CONTROL_*` codes; `status` and the default
 * English message come from the table.
 */
export class AccessControlError extends Exception {
  declare code: AccessControlErrorCode
  declare status: number

  constructor(code: AccessControlErrorCode, options: { message?: string; cause?: unknown } = {}) {
    super(options.message ?? errorTable[code].message, {
      code,
      status: errorTable[code].status,
      cause: options.cause,
    })
  }
}
