// Normalises scope and user keys per the configured key type (specification 5.1).
import { E_ACCESS_CONTROL_INVALID_KEY } from './errors.js'
import type { KeyType } from './types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const integerPattern = /^[1-9][0-9]*$/

function createInvalidKeyError(
  what: string,
  detail: string
): InstanceType<typeof E_ACCESS_CONTROL_INVALID_KEY> {
  return new E_ACCESS_CONTROL_INVALID_KEY(`access-control: ${what} ${detail}`)
}

/**
 * `integer` keys become a safe positive integer, `uuid` keys a lower-case UUID string and
 * `string` keys a string of 1 to 254 characters; anything else is `INVALID_KEY`.
 */
export function requireValidKey(keyType: KeyType, value: unknown, what: string): number | string {
  if (keyType === 'integer') {
    const number =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && integerPattern.test(value)
          ? Number(value)
          : Number.NaN
    if (!Number.isSafeInteger(number) || number < 1)
      throw createInvalidKeyError(what, 'must be a positive integer')
    return number
  }
  if (typeof value !== 'string') throw createInvalidKeyError(what, 'must be a string')
  if (keyType === 'uuid') {
    if (!uuidPattern.test(value)) throw createInvalidKeyError(what, 'must be a UUID')
    return value.toLowerCase()
  }
  if (value.length < 1 || value.length > 254)
    throw createInvalidKeyError(what, 'must be 1 to 254 characters long')
  return value
}

/**
 * Whether a string is the normalised form of a key of this type, so a system that stores and
 * orders keys as given (Account Kit's invitation scope) agrees with the package's lock order.
 */
export function isCanonicalKey(keyType: KeyType, value: string): boolean {
  try {
    return String(requireValidKey(keyType, value, 'key')) === value
  } catch {
    return false
  }
}
