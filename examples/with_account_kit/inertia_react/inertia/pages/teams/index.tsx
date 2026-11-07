import { Form, Link } from '@adonisjs/inertia/react'
import Page from '~/components/page'
import AppLayout from '~/layouts/app'

export default function TeamsIndex({
  teams,
}: {
  teams: { id: number; name: string; role: string }[]
}) {
  return (
    <Page title="Your teams">
      {teams.length > 0 ? (
        <ul>
          {teams.map((team) => (
            <li key={team.id}>
              <Link route="teams.show" routeParams={{ scopeId: team.id }}>
                {team.name}
              </Link>{' '}
              ({team.role})
            </li>
          ))}
        </ul>
      ) : (
        <p>You are not in a team yet. Create one, or ask a team admin to invite you.</p>
      )}

      <h2>Create a team</h2>
      <Form route="teams.store">
        {({ errors, processing }) => (
          <div className="auth__form">
            <div className="field">
              <label className="field__label" htmlFor="name">
                Team name
              </label>
              <input id="name" name="name" type="text" className="field__input" required />
              {errors.name && <span className="field__error">{errors.name}</span>}
            </div>
            <button type="submit" className="btn btn--primary" disabled={processing}>
              Create team
            </button>
          </div>
        )}
      </Form>
    </Page>
  )
}

TeamsIndex.layout = [AppLayout]
