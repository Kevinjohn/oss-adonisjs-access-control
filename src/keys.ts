// Normalises scope and user keys per the configured key type (specification 5.1).
import { AccessControlError } from './errors.js'
import type { KeyType } from './types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const integerPattern = /^[1-9][0-9]*$/

function invalid(what: string, detail: string): AccessControlError {
  return new AccessControlError('E_ACCESS_CONTROL_INVALID_INPUT', {
    message: `access-control: ${what} ${detail}`,
  })
}

/**
 * `integer` keys become a safe positive integer, `uuid` keys a lower-case UUID string and
 * `string` keys a string of 1 to 254 characters; anything else is `INVALID_INPUT`.
 */
export function normaliseKey(keyType: KeyType, value: unknown, what: string): number | string {
  if (keyType === 'integer') {
    const number =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && integerPattern.test(value)
          ? Number(value)
          : Number.NaN
    if (!Number.isSafeInteger(number) || number < 1)
      throw invalid(what, 'must be a positive integer')
    return number
  }
  if (typeof value !== 'string') throw invalid(what, 'must be a string')
  if (keyType === 'uuid') {
    if (!uuidPattern.test(value)) throw invalid(what, 'must be a UUID')
    return value.toLowerCase()
  }
  if (value.length < 1 || value.length > 254)
    throw invalid(what, 'must be 1 to 254 characters long')
  return value
}
