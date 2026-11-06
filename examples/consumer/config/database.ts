import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const schema = env.get('DB_SCHEMA')

const dbConfig = defineConfig({
  connection: env.get('DB_CLIENT'),
  connections: {
    sqlite: {
      client: 'better-sqlite3',
      connection: {
        filename: app.tmpPath('db.sqlite3'),
      },
      pool: {
        min: 1,
        max: 1,
        afterCreate(connection, callback) {
          connection.pragma('foreign_keys = ON')
          callback(null, connection)
        },
      },
      useNullAsDefault: true,
      migrations: { naturalSort: true, paths: ['database/migrations'] },
    },
    pg: {
      client: 'pg',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD') || undefined,
        database: env.get('DB_DATABASE'),
      },
      searchPath: schema ? [schema] : undefined,
      migrations: { naturalSort: true, paths: ['database/migrations'] },
    },
  },
})

export default dbConfig
