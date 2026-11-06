// The opaque cursor for paging a scope's members, shaped like Account Kit's invitation cursor.
import { DateTime } from 'luxon'
import { AccessControlError } from './errors.js'

const MAX_CURSOR_LENGTH = 512

export interface MembershipCursor {
  createdAt: string
  id: number
}

/** The cursor for the page after the row with this ISO `created_at` and `id`. */
export function encodeCursor(createdAt: string, id: number): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString('base64url')
}

/** Reads a cursor from `encodeCursor`; anything else is `INVALID_INPUT`. */
export function decodeCursor(cursor: string): MembershipCursor {
  const invalid = () =>
    new AccessControlError('E_ACCESS_CONTROL_INVALID_INPUT', {
      message: 'Invalid membership cursor',
    })
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH)
    throw invalid()
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw invalid()
  }
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 2 ||
    typeof decoded[0] !== 'string' ||
    !DateTime.fromISO(decoded[0], { setZone: true }).isValid ||
    !Number.isSafeInteger(decoded[1]) ||
    decoded[1] < 1 ||
    encodeCursor(decoded[0], decoded[1]) !== cursor
  )
    throw invalid()
  return { createdAt: decoded[0], id: decoded[1] }
}
