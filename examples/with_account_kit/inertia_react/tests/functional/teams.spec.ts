import { test } from '@japa/runner'
import limiter from '@adonisjs/limiter/services/main'
import accessControl from '#config/access_control'
import Team from '#models/team'
import User from '#models/user'
import { notifyOverrides } from '../../config/account_kit.js'
import { setupAccountDatabase } from '#tests/helpers/account_database'
import { InertiaSession } from '#tests/helpers/inertia_session'

const password = 'TeamsPass123!'
const invitationUrls = new Map<string, string>()

type TeamProps = { role: string; canWrite: boolean; canInvite: boolean }

/** The stored team name. */
async function teamName(teamId: number) {
  const team = await Team.findOrFail(teamId)
  return team.name
}

/** The owner creates a team through the page and lands on it. */
async function createTeam(owner: InertiaSession, name: string) {
  await owner.props('/teams')
  const created = await owner.request('/teams', { name })
  return Number(created.headers.get('location')!.split('/').at(-1))
}

/** The owner invites an address to a role; the invitee accepts and signs in. */
async function inviteAndJoin(owner: InertiaSession, teamId: number, email: string, role: string) {
  await owner.props(`/teams/${teamId}`)
  await owner.request(`/teams/${teamId}/invitations`, { email, role })
  const url = invitationUrls.get(email)
  if (!url) throw new Error(`No invitation for ${email}`)
  const path = new URL(url).pathname
  const member = new InertiaSession()
  await member.props(path)
  const accepted = await member.request(path, { password, passwordConfirmation: password })
  if (accepted.headers.get('location') !== '/login') throw new Error(`${email} did not join`)
  await member.login(email, password)
  return member
}

test.group('teams', (group) => {
  group.each.setup(async () => {
    const cleanup = await setupAccountDatabase()
    await limiter.clear(['memory'])
    invitationUrls.clear()
    const original = notifyOverrides.invitationProvision
    notifyOverrides.invitationProvision = async (invitation, url) => {
      invitationUrls.set(invitation.email, url)
    }
    return async () => {
      notifyOverrides.invitationProvision = original
      await cleanup()
    }
  })

  test('a viewer reads the team but cannot rename it; an editor can', async ({ assert }) => {
    await User.create({ email: 'owner@example.test', password })
    const owner = new InertiaSession()
    await owner.login('owner@example.test', password)
    const teamId = await createTeam(owner, 'Rockets')

    const viewer = await inviteAndJoin(owner, teamId, 'viewer@example.test', 'viewer')
    const editor = await inviteAndJoin(owner, teamId, 'editor@example.test', 'editor')

    const viewed = await viewer.props<TeamProps>(`/teams/${teamId}`)
    assert.equal(viewed.role, 'viewer')
    assert.isFalse(viewed.canWrite)

    // Bouncer's E_AUTHORIZATION_FAILURE answers an Inertia form with a redirect and an error flash.
    const refused = await viewer.request(`/teams/${teamId}`, { name: 'Viewer was here' })
    assert.equal(refused.status, 302)
    const after = await viewer.request(`/teams/${teamId}`)
    const page = (await after.json()) as { flash: { error?: string } }
    assert.equal(page.flash.error, 'Access denied')
    assert.equal(await teamName(teamId), 'Rockets')

    await editor.props(`/teams/${teamId}`)
    const renamed = await editor.request(`/teams/${teamId}`, { name: 'Comets' })
    assert.equal(renamed.headers.get('location'), `/teams/${teamId}`)
    assert.equal(await teamName(teamId), 'Comets')

    const viewerUser = await User.findByOrFail('email', 'viewer@example.test')
    const memberships = await accessControl.memberships.listForUser(viewerUser.id)
    assert.deepEqual(
      memberships.map(({ scopeId, role }) => ({ scopeId, role })),
      [{ scopeId: teamId, role: 'viewer' }]
    )
  })

  test('an account outside the team is refused', async ({ assert }) => {
    await User.create({ email: 'owner@example.test', password })
    await User.create({ email: 'outsider@example.test', password })
    const owner = new InertiaSession()
    await owner.login('owner@example.test', password)
    const teamId = await createTeam(owner, 'Rockets')

    const outsider = new InertiaSession()
    await outsider.login('outsider@example.test', password)
    const refused = await outsider.request(`/teams/${teamId}`)
    assert.equal(refused.status, 403)
    const body = (await refused.json()) as { errors: Array<{ code: string }> }
    assert.equal(body.errors[0].code, 'E_ACCESS_CONTROL_FORBIDDEN')
  })

  test('an editor cannot invite', async ({ assert }) => {
    await User.create({ email: 'owner@example.test', password })
    const owner = new InertiaSession()
    await owner.login('owner@example.test', password)
    const teamId = await createTeam(owner, 'Rockets')
    const editor = await inviteAndJoin(owner, teamId, 'editor@example.test', 'editor')

    const page = await editor.props<TeamProps>(`/teams/${teamId}`)
    assert.isFalse(page.canInvite)
    await editor.request(`/teams/${teamId}/invitations`, {
      email: 'friend@example.test',
      role: 'viewer',
    })
    assert.isFalse(invitationUrls.has('friend@example.test'))
  })
})
