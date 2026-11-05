// A Lucid Database for the client under test, with an isolated namespace per fixture.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Database } from '@adonisjs/lucid/database'
import { Logger } from '@adonisjs/core/logger'
import { Application } from '@adonisjs/core/app'
import { Emitter } from '@adonisjs/core/events'

export type TestClient = 'pg' | 'mysql2' | 'better-sqlite3'
export type TestEngine = 'sqlite' | 'pg' | 'mysql'

/** The database client under test, from `DB_CLIENT`. */
export function testClient(): TestClient {
  const client = process.env.DB_CLIENT ?? 'better-sqlite3'
  if (client !== 'pg' && client !== 'mysql2' && client !== 'better-sqlite3')
    throw new Error(`Unsupported DB_CLIENT: ${client}`)
  return client
}

const engines: Record<TestClient, TestEngine> = {
  'pg': 'pg',
  'mysql2': 'mysql',
  'better-sqlite3': 'sqlite',
}
export const testEngine: TestEngine = engines[testClient()]

/** PostgreSQL and MySQL lock rows; SQLite serialises writers through the kit's lock row. */
export const locksRows = testEngine !== 'sqlite'

export interface TestDatabase {
  db: Database
  engine: TestEngine
  /** A unique suffix for table names so MySQL fixtures never collide. */
  suffix: string
  sqliteFilename: string
  cleanup(): Promise<void>
}

function connectionConfig(
  client: TestClient,
  options: { sqliteFilename: string; schema: string; sqliteBusyTimeout: number }
) {
  if (client === 'pg')
    return {
      client: 'pg' as const,
      searchPath: [options.schema],
      connection: {
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 5432),
        user: process.env.DB_USER ?? 'postgres',
        password: process.env.DB_PASSWORD ?? 'postgres',
        database: process.env.DB_DATABASE ?? 'package_test',
      },
      pool: { min: 1, max: 4 },
    }
  if (client === 'mysql2')
    return {
      client: 'mysql2' as const,
      connection: {
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 3306),
        user: process.env.DB_USER ?? 'root',
        password: process.env.DB_PASSWORD ?? 'root',
        database: process.env.DB_DATABASE ?? 'package_test',
        timezone: 'Z',
      },
      pool: {
        min: 1,
        max: 4,
        afterCreate(
          mysql: { query(sql: string, done: (error: Error | null) => void): void },
          done: (error: Error | null, connection: unknown) => void
        ) {
          mysql.query("set time_zone = '+00:00'", (error) => done(error, mysql))
        },
      },
    }
  return {
    client: 'better-sqlite3' as const,
    connection: { filename: options.sqliteFilename },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 4,
      afterCreate(
        sqlite: { pragma(query: string): unknown },
        done: (error: Error | null, connection: unknown) => void
      ) {
        sqlite.pragma(`busy_timeout = ${options.sqliteBusyTimeout}`)
        sqlite.pragma('foreign_keys = ON')
        done(null, sqlite)
      },
    },
  }
}

/** Opens a Database on the client under test. PostgreSQL fixtures get their own schema. */
export async function testDatabase(
  options: { sqliteBusyTimeout?: number; timezone?: string; sqliteFilename?: string } = {}
): Promise<TestDatabase> {
  const client = testClient()
  const suffix = randomBytes(4).toString('hex')
  const schema = `ac_fixture_${suffix}`
  const directory = await mkdtemp(join(tmpdir(), 'access_control_'))
  const config = connectionConfig(client, {
    sqliteFilename: options.sqliteFilename ?? join(directory, 'test.sqlite'),
    schema,
    sqliteBusyTimeout: options.sqliteBusyTimeout ?? 5000,
  })
  if (options.timezone !== undefined && config.client === 'mysql2')
    config.connection.timezone = options.timezone
  const db = new Database(
    { connection: 'test', connections: { test: config } },
    new Logger({ name: 'test', enabled: false }),
    new Emitter(new Application(new URL('../../', import.meta.url), { environment: 'test' }))
  )
  if (client === 'pg') await db.rawQuery(`create schema "${schema}"`)
  return {
    db,
    engine: testEngine,
    suffix,
    sqliteFilename: config.client === 'better-sqlite3' ? config.connection.filename : '',
    async cleanup() {
      try {
        if (client === 'pg') await db.rawQuery(`drop schema "${schema}" cascade`)
      } finally {
        try {
          await db.manager.closeAll()
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      }
    },
  }
}
