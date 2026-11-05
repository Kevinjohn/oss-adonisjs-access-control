/** A plain SQL identifier: letters, digits and underscores, not starting with a digit. */
export const sqlIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isSqlIdentifier(value: unknown): value is string {
  return typeof value === 'string' && sqlIdentifierPattern.test(value)
}
