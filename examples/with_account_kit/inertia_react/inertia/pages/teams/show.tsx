import { Form } from '@adonisjs/inertia/react'
import Page from '~/components/page'
import AppLayout from '~/layouts/app'

export default function TeamShow({
  team,
  role,
  members,
  canWrite,
  canInvite,
  invitableRoles,
}: {
  team: { id: number; name: string }
  role: string
  members: { email: string; role: string }[]
  canWrite: boolean
  canInvite: boolean
  invitableRoles: string[]
}) {
  return (
    <Page title={team.name}>
      <p>
        Your role: <strong>{role}</strong>.
      </p>

      {canWrite && (
        <>
          <h2>Rename the team</h2>
          <Form route="teams.update" routeParams={{ scopeId: team.id }}>
            {({ errors, processing }) => (
              <div className="auth__form">
                <div className="field">
                  <label className="field__label" htmlFor="name">
                    Team name
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    className="field__input"
                    defaultValue={team.name}
                    required
                  />
                  {errors.name && <span className="field__error">{errors.name}</span>}
                </div>
                <button type="submit" className="btn btn--primary" disabled={processing}>
                  Rename team
                </button>
              </div>
            )}
          </Form>
        </>
      )}

      <h2>Members</h2>
      <ul>
        {members.map((member) => (
          <li key={member.email}>
            {member.email} ({member.role})
          </li>
        ))}
      </ul>

      {canInvite && (
        <>
          <h2>Invite a member</h2>
          <Form route="team_invitations.store" routeParams={{ scopeId: team.id }} resetOnSuccess>
            {({ errors, processing }) => (
              <div className="auth__form">
                <div className="field">
                  <label className="field__label" htmlFor="email">
                    Email
                  </label>
                  <input id="email" name="email" type="email" className="field__input" required />
                  {errors.email && <span className="field__error">{errors.email}</span>}
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="role">
                    Role
                  </label>
                  <select id="role" name="role" className="field__input">
                    {invitableRoles.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn--primary" disabled={processing}>
                  Send invitation
                </button>
              </div>
            )}
          </Form>
        </>
      )}
    </Page>
  )
}

TeamShow.layout = [AppLayout]
