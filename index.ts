/**
 * Public entry point. `node ace configure` reads `configure` and `stubsRoot` from here.
 */
export { configure } from './configure.js'
export { stubsRoot } from './stubs/main.js'
export { defineAccessControl, AccessControl } from './src/define.js'
export { AccessControlError, errorTable } from './src/errors.js'
export * as errors from './src/errors.js'
export type * from './src/types.js'
