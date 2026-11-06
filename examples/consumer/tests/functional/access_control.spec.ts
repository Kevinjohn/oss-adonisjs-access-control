import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import accessControl from '@kevinjohn/adonisjs-access-control/services/main'
import User from '#models/user'

async function createUser(email: string) {
  return User.create({ email, password: 'secret-password', fullName: email })
}

/** A session the kit established: the user plus the credential revision it stamps at sign-in. */
function signedIn<T extends { loginAs(user: User): T; withSession(data: object): T }>(
  request: T,
  user: User
): T {
  return request.loginAs(user).withSession({ accountKitRevision: '' })
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
    const response = await signedIn(client.get(`/teams/${scopeId}/project`), editor)
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

  test('the kit middleware refuses a guest and a stale session before the scope middleware', async ({
    client,
  }) => {
    const guest = await client.get(`/teams/${scopeId}/project`)
    guest.assertStatus(401)
    // A session without the kit's revision stamp was not established by the kit.
    const unstamped = await client.get(`/teams/${scopeId}/project`).loginAs(editor)
    unstamped.assertStatus(401)
    // A credential change after sign-in moves the revision; the old session is refused.
    editor.credentialsChangedAt = DateTime.now()
    await editor.save()
    try {
      const stale = await signedIn(client.get(`/teams/${scopeId}/project`), editor)
      stale.assertStatus(401)
    } finally {
      editor.credentialsChangedAt = null
      await editor.save()
    }
  })

  test('authorize refuses an editor with 403 and allows the owner', async ({ client }) => {
    const refused = await signedIn(client.post(`/teams/${scopeId}/archive`), editor)
    refused.assertStatus(403)
    const allowed = await signedIn(client.post(`/teams/${scopeId}/archive`), owner)
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
      const response = await signedIn(client.get(path), user)
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
