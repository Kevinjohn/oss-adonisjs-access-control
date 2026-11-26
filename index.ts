/**
 * Public entry point. `node ace configure` reads `configure` and `stubsRoot` from here.
 */
export { configure } from './configure.ts'
export { stubsRoot } from './stubs/main.ts'
export { defineAccessControl, defineConfig, AccessControl } from './src/define.ts'
export * as errors from './src/errors.ts'
export type * from './src/types.ts'
