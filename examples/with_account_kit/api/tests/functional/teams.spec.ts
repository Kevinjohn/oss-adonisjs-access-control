import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import User from '#models/user'
import Team from '#models/team'
import accessControl from '#config/access_control'
import { notifications } from '#services/account_kit_notifications'
import { grantAdmittedOwner } from '#tests/helpers/admission'
import { truncateDatabase } from '#tests/helpers/database'
import { tokenFrom } from '#tests/helpers/link_tokens'
import { responseBody } from '#tests/helpers/response_body'

const password = 'TeamsPass123!'

/** The owner invites `email` to the team; the invitee accepts and the owner admits them. */
async function join(client: ApiClient, owner: User, scope: string, email: string, role: string) {
  const sent = await client
    .post('/api/v1/account/invitations')
    .loginAs(owner)
    .json({ email, role, scope })
  if (sent.status() !== 201) throw new Error(`Invite failed: ${JSON.stringify(sent.body())}`)
  const notice = notifications.events.findLast(
    (event) => event.kind === 'invitation' && event.recipient === email
  )
  const accepted = await client
    .post(`/api/v1/auth/invitations/${encodeURIComponent(tokenFrom(notice!.value))}`)
    .json({ password, passwordConfirmation: password })
  if (accepted.status() !== 201)
    throw new Error(`Accept failed: ${JSON.stringify(accepted.body())}`)
  const member = await User.findByOrFail('email', email)
  const approved = await client
    .post(`/api/v1/account/admissions/${member.id}/approve`)
    .loginAs(owner)
    .json({})
  if (approved.status() !== 200)
    throw new Error(`Approve failed: ${JSON.stringify(approved.body())}`)
  return member
}

/** The stored team name. */
async function teamName(scope: string) {
  const team = await Team.findOrFail(scope)
  return team.name
}

test.group('teams', (group) => {
  group.each.setup(truncateDatabase)

  test('a viewer reads the team but cannot rename it; an editor can', async ({
    client,
    assert,
  }) => {
    notifications.reset()
    const owner = await User.create({
      email: 'owner@example.test',
      password,
      emailVerifiedAt: DateTime.utc(),
    })
    await grantAdmittedOwner(owner)
    const created = await client.post('/api/v1/teams').loginAs(owner).json({ name: 'Rockets' })
    assert.equal(created.status(), 201)
    const scope = String(responseBody<{ id: number }>(created).id)

    const viewer = await join(client, owner, scope, 'viewer@example.test', 'viewer')
    const editor = await join(client, owner, scope, 'editor@example.test', 'editor')
    const membership = await accessControl.memberships.find(scope, viewer.id)
    assert.equal(membership?.role, 'viewer')

    const read = await client.get(`/api/v1/teams/${scope}`).loginAs(viewer)
    assert.equal(read.status(), 200)
    assert.equal(responseBody<{ name: string }>(read).name, 'Rockets')

    const refused = await client
      .patch(`/api/v1/teams/${scope}`)
      .loginAs(viewer)
      .header('accept', 'application/vnd.api+json')
      .json({ name: 'Viewer was here' })
    assert.equal(refused.status(), 403)
    const refusal = responseBody<{ errors: Array<{ code: string }> }>(refused)
    assert.equal(refusal.errors[0].code, 'E_AUTHORIZATION_FAILURE')
    assert.equal(await teamName(scope), 'Rockets')

    const renamed = await client
      .patch(`/api/v1/teams/${scope}`)
      .loginAs(editor)
      .json({ name: 'Comets' })
    assert.equal(renamed.status(), 200)
    assert.equal(await teamName(scope), 'Comets')
  })

  test('an account outside the team is refused', async ({ client, assert }) => {
    const owner = await User.create({
      email: 'owner@example.test',
      password,
      emailVerifiedAt: DateTime.utc(),
    })
    const outsider = await User.create({
      email: 'outsider@example.test',
      password,
      emailVerifiedAt: DateTime.utc(),
    })
    const scope = await grantAdmittedOwner(owner)
    await grantAdmittedOwner(outsider)

    const refused = await client.get(`/api/v1/teams/${scope}`).loginAs(outsider)
    assert.equal(refused.status(), 403)
    const refusal = responseBody<{ errors: Array<{ code: string }> }>(refused)
    assert.equal(refusal.errors[0].code, 'E_ACCESS_CONTROL_FORBIDDEN')
  })
})
