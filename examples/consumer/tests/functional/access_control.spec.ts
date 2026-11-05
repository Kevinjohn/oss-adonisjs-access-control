import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import accessControl from '@kevinjohn/adonisjs-access-control/services/main'
import User from '#models/user'

async function createUser(email: string) {
  return User.create({ email, password: 'secret-password', fullName: email })
}

test.group('Scoped routes with the package middleware and Bouncer abilities', (group) => {
  let scopeId: number
  let owner: User
  let editor: User
  let suspended: User
  let outsider: User

  group.setup(async () => {
    const [team] = await db
      .table('teams')
      .returning('id')
      .insert({ name: 'Team', created_at: new Date() })
    scopeId = Number(typeof team === 'object' ? team.id : team)
    ;[owner, editor, suspended, outsider] = await Promise.all([
      createUser('owner@example.com'),
      createUser('editor@example.com'),
      createUser('suspended@example.com'),
      createUser('outsider@example.com'),
    ])
    await accessControl.memberships.createFirstMember({ scopeId, userId: owner.id })
    await accessControl.memberships.add({
      actor: { id: owner.id },
      scopeId,
      userId: editor.id,
      role: 'editor',
    })
    await accessControl.memberships.add({
      actor: { id: owner.id },
      scopeId,
      userId: suspended.id,
      role: 'admin',
    })
    await accessControl.memberships.setStatus({
      actor: { id: owner.id },
      scopeId,
      userId: suspended.id,
      status: 'suspended',
    })
  })

  test('an editor sees its payload and Bouncer answers per key', async ({ client }) => {
    const response = await client.get(`/teams/${scopeId}/project`).loginAs(editor)
    response.assertStatus(200)
    response.assertBodyContains({
      membership: {
        scopeId: String(scopeId),
        role: 'editor',
        permissions: ['project:read', 'project:write'],
        assignableRoles: [],
      },
      canWrite: true,
      canArchive: false,
      canViewDashboard: true,
    })
  })

  test('the kit middleware alone leaves ctx.auth.user for the scope middleware and Bouncer', async ({
    client,
  }) => {
    // The session carries the kit's revision stamp, as a kit sign-in would store it.
    const response = await client
      .get(`/teams/${scopeId}/kit-only`)
      .loginAs(editor)
      .withSession({ accountKitRevision: '' })
    response.assertStatus(200)
    response.assertBodyContains({
      membership: { scopeId: String(scopeId), role: 'editor' },
      canWrite: true,
    })
    const guest = await client.get(`/teams/${scopeId}/kit-only`)
    guest.assertStatus(401)
  })

  test('authorize refuses an editor with 403 and allows the owner', async ({ client }) => {
    const refused = await client.post(`/teams/${scopeId}/archive`).loginAs(editor)
    refused.assertStatus(403)
    const allowed = await client.post(`/teams/${scopeId}/archive`).loginAs(owner)
    allowed.assertStatus(200)
    allowed.assertBodyContains({ archived: true })
  })

  test('a non-member, a suspended member and an unknown team are refused with the package error shape', async ({
    client,
  }) => {
    for (const [user, path] of [
      [outsider, `/teams/${scopeId}/project`],
      [suspended, `/teams/${scopeId}/project`],
      [owner, '/teams/999999/project'],
      [owner, '/teams/not-a-team/project'],
    ] as const) {
      const response = await client.get(path).loginAs(user)
      response.assertStatus(403)
      response.assertHeader('cache-control', 'no-store')
      response.assertBodyContains({
        errors: [
          { code: 'E_ACCESS_CONTROL_FORBIDDEN', message: 'You do not have permission to do that.' },
        ],
      })
    }
  })

  test('a guest never reaches the scope middleware', async ({ client }) => {
    const response = await client.get(`/teams/${scopeId}/project`)
    response.assertStatus(401)
  })
})

test.group('Account Kit callbacks wired in config/account_kit.ts', () => {
  test('the kit config carries the package callbacks and they answer from the memberships table', async ({
    assert,
  }) => {
    const { default: kitConfig } = await import('#config/account_kit')
    const [team] = await db
      .table('teams')
      .returning('id')
      .insert({ name: 'Kit team', created_at: new Date() })
    const scopeId = Number(typeof team === 'object' ? team.id : team)
    const owner = await createUser('kit-owner@example.com')
    await accessControl.memberships.createFirstMember({ scopeId, userId: owner.id })
    const actor = { id: owner.id, email: owner.email } as never
    assert.isTrue(
      await kitConfig.authorize.invite(actor, 'editor', { scope: String(scopeId) } as never)
    )
    assert.isFalse(
      await kitConfig.authorize.invite(actor, 'owner', { scope: String(scopeId) } as never)
    )
    assert.isFalse(await kitConfig.authorize.invite(actor, 'editor'))
    const exported = await db.transaction((trx) => kitConfig.exportAccountData!(actor, trx))
    assert.deepInclude((exported as { memberships: unknown[] }).memberships[0], {
      scopeId,
      role: 'owner',
    })
  })
})

test.group('Scoped invitations through Account Kit', () => {
  /** The consumer's kit with deliveries captured instead of thrown, and no credential policy. */
  async function kitCapturingLinks() {
    const { AccountKit } = await import('@kevinjohn/adonisjs-account-kit')
    const { default: kitConfig } = await import('#config/account_kit')
    const links: string[] = []
    const capture = async (_target: unknown, link: string) => {
      links.push(link)
    }
    const config = {
      ...kitConfig,
      enabled: [...kitConfig.enabled, 'invitations'],
      notify: {
        ...kitConfig.notify,
        invitationProvision: capture,
        accountActivationProvision: capture,
      },
      onCredentialsChangedTransaction: async () => {},
    } as unknown as typeof kitConfig
    const kit = new AccountKit({ config, db, limiter: await app.container.make('limiter.manager') })
    const lastToken = () => decodeURIComponent(new URL(links.at(-1)!).pathname.split('/').at(-1)!)
    return { kit, lastToken }
  }

  async function createTeam(name: string) {
    const [team] = await db.table('teams').returning('id').insert({ name, created_at: new Date() })
    return Number(typeof team === 'object' ? team.id : team)
  }

  test('one address invited to two teams gets both memberships on acceptance, in scope order', async ({
    assert,
  }) => {
    const { kit, lastToken } = await kitCapturingLinks()
    const owner = await createUser('inviter@example.com')
    const scopes = [await createTeam('Invite A'), await createTeam('Invite B')]
    for (const scopeId of scopes)
      await accessControl.memberships.createFirstMember({ scopeId, userId: owner.id })
    const email = 'twice-invited@example.com'
    const tokens: string[] = []
    // Sent in reverse scope order; acceptance still grants in ascending String(scope) order.
    for (const scopeId of [...scopes].reverse()) {
      await kit.invitations.send({
        actorId: owner.id,
        email,
        role: 'editor',
        scope: String(scopeId),
      })
      tokens.push(lastToken())
    }
    const user = await kit.invitations.accept({ token: tokens[0], password: 'accepted-password-1' })
    const memberships = await accessControl.memberships.listForUser(user.id)
    assert.deepEqual(
      memberships.map((m) => [String(m.scopeId), m.role, m.status]),
      scopes
        .map(String)
        .sort()
        .map((scopeId) => [scopeId, 'editor', 'active'])
    )
    // The second invitation was consumed by the same acceptance.
    assert.isNull(await kit.invitations.inspect({ token: tokens[1] }))
  })

  test('a self-registered user with a pending scoped invitation joins the team on activation', async ({
    assert,
  }) => {
    const { kit, lastToken } = await kitCapturingLinks()
    const owner = await createUser('matcher@example.com')
    const scopeId = await createTeam('Invite match')
    await accessControl.memberships.createFirstMember({ scopeId, userId: owner.id })
    const email = 'registered-later@example.com'
    await kit.invitations.send({ actorId: owner.id, email, role: 'editor', scope: String(scopeId) })
    const user = await kit.registration.register({ email, password: 'registered-password-1' })
    assert.deepEqual(await accessControl.memberships.listForUser(user.id), [])
    await kit.emailVerification.complete({ token: lastToken(), password: 'registered-password-1' })
    const joined = await accessControl.memberships.listForUser(user.id)
    assert.deepEqual(
      joined.map((m) => [String(m.scopeId), m.role]),
      [[String(scopeId), 'editor']]
    )

test.group('access-control:doctor in the consumer', () => {
  test('the doctor runs through ace against the migrated database and exits 0', async ({
    assert,
  }) => {
    const { default: ace } = await import('@adonisjs/core/services/ace')
    ace.ui.switchMode('raw')
    const command = await ace.exec('access-control:doctor', ['--json'])
    const logs = (ace.ui.logger.getLogs() as Array<{ message: string }>).map((l) => l.message)
    const report = JSON.parse(logs.find((line) => line.startsWith('{'))!) as {
      checks: Array<{ name: string; ok: boolean }>
    }
    assert.equal(command.exitCode, 0, logs.join('\n'))
    assert.include(
      report.checks.map((c) => c.name),
      'account_kit_version'
    )
    assert.isTrue(report.checks.every((c) => c.ok))
  })
})
