import { defineConfig } from '@adonisjs/core/app'

export default defineConfig({
  commands: [
    () => import('@adonisjs/core/commands'),
    () => import('@adonisjs/lucid/commands'),
    () => import('@adonisjs/bouncer/commands'),
    () => import('@kevinjohn/adonisjs-account-kit/commands'),
  ],

  providers: [
    () => import('@adonisjs/core/providers/app_provider'),
    () => import('@adonisjs/core/providers/hash_provider'),
    {
      file: () => import('@adonisjs/core/providers/repl_provider'),
      environment: ['repl', 'test'],
    },
    () => import('@adonisjs/core/providers/vinejs_provider'),
    () => import('@adonisjs/session/session_provider'),
    () => import('@adonisjs/lucid/database_provider'),
    () => import('@adonisjs/auth/auth_provider'),
    () => import('@adonisjs/limiter/limiter_provider'),
    () => import('@adonisjs/bouncer/bouncer_provider'),
    () => import('@kevinjohn/adonisjs-account-kit/account_kit_provider'),
    () => import('@kevinjohn/adonisjs-access-control/access_control_provider'),
  ],

  preloads: [() => import('#start/routes'), () => import('#start/kernel')],

  tests: {
    suites: [
      {
        files: ['tests/functional/**/*.spec.{ts,js}'],
        name: 'functional',
        timeout: 30000,
      },
    ],
    forceExit: false,
  },
})
