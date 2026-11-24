import type { errors } from '../../index.js'

type ErrorClasses = typeof errors

type DetailCode =
  | 'E_ACCESS_CONTROL_INVALID_KEY'
  | 'E_ACCESS_CONTROL_INVALID_INVITATION_SCOPE'
  | 'E_ACCESS_CONTROL_INVALID_STORED_TIMESTAMP'
type FixedCode = Exclude<keyof ErrorClasses, DetailCode>

type FixedConstructorsWithArguments = {
  [Code in FixedCode]: ConstructorParameters<ErrorClasses[Code]> extends [] ? never : Code
}[FixedCode]

type Assert<T extends true> = T

export type FixedErrorsTakeNoArguments = Assert<
  [FixedConstructorsWithArguments] extends [never] ? true : false
>
