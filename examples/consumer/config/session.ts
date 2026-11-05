import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, stores } from '@adonisjs/session'
import { protectManagedSessionConfig } from '@kevinjohn/adonisjs-account-kit/http'

const sessionConfig = defineConfig({
  enabled: true,
  cookieName: 'adonis-session',
  clearWithBrowser: false,
  age: '2h',
  cookie: {
    path: '/',
    httpOnly: true,
    secure: app.inProduction,
    sameSite: 'lax',
  },
  store: env.get('SESSION_DRIVER'),
  stores: {
    cookie: stores.cookie(),
  },
})

/**
 * Account Kit's session guard needs a server-side store that forgets a destroyed session id. The
 * package's built-in memory store does (`SESSION_DRIVER=memory`); pick a database or Redis store
 * in production and attest it the same way.
 */
export default protectManagedSessionConfig(sessionConfig, {
  verifyStore: (store) =>
    (store as { constructor?: { name?: string } }).constructor?.name === 'MemoryStore',
})
