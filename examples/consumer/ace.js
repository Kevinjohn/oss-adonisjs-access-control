/*
|--------------------------------------------------------------------------
| JavaScript entrypoint for running ace commands
|--------------------------------------------------------------------------
|
| Since, we cannot run TypeScript source code using "node" binary, we need
| this file to register the TS compiler hook and then import the
| "bin/console.ts" file.
|
*/
import '@poppinss/ts-exec'
await import('./bin/console.js')
