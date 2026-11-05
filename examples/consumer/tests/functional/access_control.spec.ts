import { test } from '@japa/runner'
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
