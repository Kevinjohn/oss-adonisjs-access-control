// An AdonisJS application with Lucid and the package provider, over a fresh fixture schema.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { defineConfig as defineDatabaseConfig } from '@adonisjs/lucid'
import type { Database } from '@adonisjs/lucid/database'
import type { ApplicationService } from '@adonisjs/core/types'
import { defineAccessControl } from '../../index.js'
import type { MembershipEvent, PermissionMap, Trx } from '../../src/types.js'
import { connectionConfig, testClient, testEngine } from './database.js'
import { createSchema, dropSchema, type SchemaNames } from './schema.js'
import { permissions, roles, type Role } from './fixture.js'

export interface TestApp {
  app: ApplicationService
  db: Database
  names: SchemaNames
  close(): Promise<void>
}

/** Boots core providers, Lucid and the package provider with the given `access_control` config value. */
export async function bootTestApp(
  options: {
    accessControl?: unknown
    withProvider?: boolean
    onMembershipChanged?: (event: MembershipEvent<string>, trx: Trx) => Promise<void>
    permissions?: PermissionMap<Role>
  } = {}
): Promise<TestApp> {
  const client = testClient()
  const suffix = randomBytes(4).toString('hex')
  const schema = `ac_fixture_${suffix}`
  const directory = await mkdtemp(join(tmpdir(), 'access_control_app_'))
  const names: SchemaNames = {
    users: `users_${suffix}`,
    scope: `teams_${suffix}`,
    memberships: `memberships_${suffix}`,
  }
  const connection = connectionConfig(client, {
    sqliteFilename: join(directory, 'app.sqlite'),
    schema,
    sqliteBusyTimeout: 5000,
  })
  const accessControl =
    'accessControl' in options
      ? options.accessControl
      : defineAccessControl({
          roles: [...roles],
          ownerRole: 'owner',
          users: { table: names.users, keyType: 'integer' },
          scope: { table: names.scope, keyType: 'integer' },
          membershipsTable: names.memberships,
          permissions: options.permissions ?? permissions,
          onMembershipChanged: options.onMembershipChanged,
        })
  const factory = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({
      rcFileContents: {
        providers: [
          () => import('@adonisjs/lucid/database_provider'),
          ...(options.withProvider === false
            ? []
            : [() => import('../../providers/access_control_provider.js')]),
        ],
      },
      config: {
        database: defineDatabaseConfig({ connection: 'test', connections: { test: connection } }),
        ...(accessControl === undefined ? {} : { access_control: accessControl }),
      },
    })
  const ignitor = factory.create(new URL('../../', import.meta.url))
  const app = ignitor.createApp('console')
  let db: Database | undefined
  try {
    await app.init()
    await app.boot()
    db = await app.container.make('lucid.db')
    if (client === 'pg') await db.rawQuery(`create schema "${schema}"`)
    await createSchema(db, names, { users: 'integer', scope: 'integer' })
  } catch (error) {
    try {
      if (db && client === 'pg') await db.rawQuery(`drop schema if exists "${schema}" cascade`)
    } finally {
      try {
        await ignitor.terminate()
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
    throw error
  }
  return {
    app,
    db,
    names,
    async close() {
      try {
        if (testEngine === 'pg') await db!.rawQuery(`drop schema "${schema}" cascade`)
        else await dropSchema(db!, names)
      } finally {
        try {
          await ignitor.terminate()
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      }
    },
  }
}
