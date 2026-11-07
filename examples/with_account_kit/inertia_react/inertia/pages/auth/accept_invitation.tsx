import AuthLayout from '~/layouts/auth'
import FormErrorSummary, { focusFormErrorSummary } from '~/components/form_error_summary'
import { Form, Link } from '@adonisjs/inertia/react'
import { type InertiaProps } from '~/types'

type Props = InertiaProps<{ token: string; email: string | null }>

const fields = [
  { name: 'fullName', label: 'Full name (optional)' },
  { name: 'password', label: 'Password' },
  { name: 'passwordConfirmation', label: 'Confirm password' },
] as const

export default function AcceptInvitation({ token, email }: Props) {
  if (!email) {
    return (
      <>
        <h1 className="auth__title">This invitation can’t be used</h1>
        <p className="auth__sub">It may be invalid, already used, or expired.</p>
        <p className="auth__foot">
          Already have an account?{' '}
          <Link route="session.create" className="il">
            Sign in
          </Link>
        </p>
      </>
    )
  }

  return (
    <>
      <h1 className="auth__title">Join the team</h1>
      <p className="auth__sub">
        Choose a password for <strong>{email}</strong>. The invitation can be used once.
      </p>
      <Form
        route="invitations.update"
        routeParams={{ token }}
        resetOnError={['password', 'passwordConfirmation']}
        onError={focusFormErrorSummary}
      >
        {({ errors, processing }) => (
          <div className="auth__form">
            <FormErrorSummary errors={errors} fields={fields} />
            {fields.map((field) => (
              <div className="field" key={field.name}>
                <label className="field__label" htmlFor={field.name}>
                  {field.label}
                </label>
                <input
                  id={field.name}
                  name={field.name}
                  type={field.name === 'fullName' ? 'text' : 'password'}
                  className="field__input"
                  autoComplete={field.name === 'fullName' ? 'name' : 'new-password'}
                  aria-invalid={errors[field.name] ? true : undefined}
                />
                {errors[field.name] && <span className="field__error">{errors[field.name]}</span>}
              </div>
            ))}
            <button type="submit" className="btn btn--primary btn--block" disabled={processing}>
              Create account and join
            </button>
          </div>
        )}
      </Form>
    </>
  )
}

AcceptInvitation.layout = [AuthLayout]
