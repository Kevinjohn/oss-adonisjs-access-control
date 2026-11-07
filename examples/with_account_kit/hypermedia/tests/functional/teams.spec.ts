import { test } from '@japa/runner'
import limiter from '@adonisjs/limiter/services/main'
import accessControl from '#config/access_control'
import Team from '#models/team'
import User from '#models/user'
import { accountKitNotifications } from '#services/account_kit_notifications'
import { setupAccountDatabase } from '#tests/helpers/account_database'
import { FormSession } from '#tests/helpers/form_session'

const password = 'TeamsPass123!'

/** The owner creates a team through the page and lands on it. */
async function createTeam(owner: FormSession, name: string) {
  await owner.request('/teams')
  const created = await owner.request('/teams', { name })
  const location = created.headers.get('location')!
  return Number(location.split('/').at(-1))
}

/** The owner invites an address to a role; the invitee accepts and signs in. */
async function inviteAndJoin(owner: FormSession, teamId: number, email: string, role: string) {
  await owner.request(`/teams/${teamId}`)
  await owner.request(`/teams/${teamId}/invitations`, { email, role })
  const token = accountKitNotifications.tokenFor('invitationProvision', email)
  const member = new FormSession()
  await member.request(`/invitation/${token}`)
  const accepted = await member.request(`/invitation/${token}`, {
    password,
    passwordConfirmation: password,
  })
  if (accepted.headers.get('location') !== '/login') throw new Error(`${email} did not join`)
  await member.login(email, password)
  return member
}

/** The stored team name. */
async function teamName(teamId: number) {
  const team = await Team.findOrFail(teamId)
  return team.name
}

/** Submits the rename form, asking for JSON:API so Bouncer's refusal carries its code. */
async function rename(session: FormSession, teamId: number, name: string) {
  await session.request(`/teams/${teamId}`)
  return session.request(`/teams/${teamId}`, { name }, 'application/vnd.api+json')
}

test.group('teams', (group) => {
  group.each.setup(async () => {
    const cleanup = await setupAccountDatabase()
    await limiter.clear(['memory'])
    accountKitNotifications.clear()
    return cleanup
  })

  test('a viewer reads the team but cannot rename it; an editor can', async ({ assert }) => {
    await User.create({ email: 'owner@example.test', password })
    const owner = new FormSession()
    await owner.login('owner@example.test', password)
    const teamId = await createTeam(owner, 'Rockets')

    const viewer = await inviteAndJoin(owner, teamId, 'viewer@example.test', 'viewer')
    const editor = await inviteAndJoin(owner, teamId, 'editor@example.test', 'editor')

    const read = await viewer.request(`/teams/${teamId}`)
    assert.equal(read.status, 200)
    assert.include(viewer.html, 'Your role: <strong>viewer</strong>')
    assert.notInclude(viewer.html, 'Rename team')

    const refused = await rename(viewer, teamId, 'Viewer was here')
    assert.equal(refused.status, 403)
    const body = (await refused.json()) as { errors: Array<{ code: string }> }
    assert.equal(body.errors[0].code, 'E_AUTHORIZATION_FAILURE')
    assert.equal(await teamName(teamId), 'Rockets')

    const renamed = await rename(editor, teamId, 'Comets')
    assert.equal(renamed.headers.get('location'), `/teams/${teamId}`)
    assert.equal(await teamName(teamId), 'Comets')

    const viewerUser = await User.findByOrFail('email', 'viewer@example.test')
    const members = await accessControl.memberships.listForUser(viewerUser.id)
    assert.deepEqual(
      members.map(({ scopeId, role }) => ({ scopeId, role })),
      [{ scopeId: teamId, role: 'viewer' }]
    )
  })

  test('an account outside the team is refused', async ({ assert }) => {
    await User.create({ email: 'owner@example.test', password })
    await User.create({ email: 'outsider@example.test', password })
    const owner = new FormSession()
    await owner.login('owner@example.test', password)
    const teamId = await createTeam(owner, 'Rockets')

    const outsider = new FormSession()
    await outsider.login('outsider@example.test', password)
    const refused = await outsider.request(`/teams/${teamId}`, undefined, 'application/json')
    assert.equal(refused.status, 403)
    const body = (await refused.json()) as { errors: Array<{ code: string }> }
    assert.equal(body.errors[0].code, 'E_ACCESS_CONTROL_FORBIDDEN')
  })

  test('an editor cannot invite', async ({ assert }) => {
    await User.create({ email: 'owner@example.test', password })
    const owner = new FormSession()
    await owner.login('owner@example.test', password)
    const teamId = await createTeam(owner, 'Rockets')
    const editor = await inviteAndJoin(owner, teamId, 'editor@example.test', 'editor')

    await editor.request(`/teams/${teamId}`)
    assert.notInclude(editor.html, 'Send invitation')
    const refused = await editor.request(
      `/teams/${teamId}/invitations`,
      { email: 'friend@example.test', role: 'viewer' },
      'application/json'
    )
    assert.equal(refused.status, 403)
    assert.isUndefined(accountKitNotifications.last('invitationProvision', 'friend@example.test'))
  })
})
