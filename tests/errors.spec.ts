import { Exception } from '@adonisjs/core/exceptions'
import { test } from '@japa/runner'
import { errors } from '../index.js'
import type { AccessControlErrorCode } from '../src/types.js'

function fakeContext(i18n?: { t(key: string, data: unknown, fallback: string): string }) {
  const sent: { status?: number; headers: Record<string, string>; body?: unknown } = { headers: {} }
  const response = {
    status(code: number) {
      sent.status = code
      return response
    },
    header(name: string, value: string) {
      sent.headers[name] = value
      return response
    },
    json(body: unknown) {
      sent.body = body
      return response
    },
  }
  return { ctx: { response, ...(i18n ? { i18n } : {}) }, sent }
}

test.group('errors: public exception classes (spec 6)', () => {
  test('every exported cause has its own class and stable metadata', ({ assert }) => {
    const expected: Record<AccessControlErrorCode, readonly [number, string]> = {
      E_ACCESS_CONTROL_NOT_A_MEMBER: [404, 'That person is not a member of this team.'],
      E_ACCESS_CONTROL_USER_NOT_FOUND: [404, 'That person does not exist.'],
      E_ACCESS_CONTROL_ALREADY_MEMBER: [409, 'That person is already a member of this team.'],
      E_ACCESS_CONTROL_UNKNOWN_ROLE: [422, 'That role does not exist.'],
      E_ACCESS_CONTROL_RANK_TOO_LOW: [403, 'You cannot manage someone with a higher role.'],
      E_ACCESS_CONTROL_OWNER_PROTECTED: [
        409,
        'The owner cannot be changed, suspended or removed except through an ownership transfer.',
      ],
      E_ACCESS_CONTROL_SELF_MANAGEMENT: [409, 'You cannot change your own role or status.'],
      E_ACCESS_CONTROL_OWNER_DISABLED: [409, 'This application has no owner role.'],
      E_ACCESS_CONTROL_LAST_OWNER: [409, 'Transfer ownership before deleting this account.'],
      E_ACCESS_CONTROL_SCOPE_NOT_EMPTY: [409, 'This team already has members.'],
      E_ACCESS_CONTROL_SCOPE_NOT_FOUND: [404, 'That team does not exist.'],
      E_ACCESS_CONTROL_CONFLICT: [409, 'The team changed while it was being deleted. Try again.'],
      E_ACCESS_CONTROL_INVALID_KEY: [422, 'The identifier is not valid.'],
      E_ACCESS_CONTROL_INVALID_CURSOR: [422, 'Invalid membership cursor'],
      E_ACCESS_CONTROL_INVALID_PAGE_LIMIT: [
        422,
        'access-control: limit must be an integer from 1 to 100',
      ],
      E_ACCESS_CONTROL_INVALID_MEMBERSHIP_STATUS: [
        422,
        'access-control: status must be active or suspended',
      ],
      E_ACCESS_CONTROL_INVALID_INVITATION_SCOPE: [
        422,
        'The invitation scope must use the canonical spelling.',
      ],
      E_ACCESS_CONTROL_FIRST_MEMBER_MUST_BE_OWNER: [
        422,
        'access-control: the first member takes the owner role',
      ],
      E_ACCESS_CONTROL_FIRST_MEMBER_ROLE_REQUIRED: [
        422,
        'access-control: the first member needs a role with members:manage',
      ],
      E_ACCESS_CONTROL_FIRST_MEMBER_ROLE_CANNOT_MANAGE: [
        422,
        'access-control: the first member needs a role with members:manage',
      ],
      E_ACCESS_CONTROL_OWNER_ROLE_NOT_GRANTABLE: [
        422,
        'The owner role cannot be granted directly or through an invitation.',
      ],
      E_ACCESS_CONTROL_OWNERSHIP_TARGET_SUSPENDED: [
        422,
        'access-control: ownership can only go to an active member',
      ],
      E_ACCESS_CONTROL_INVALID_STORED_ROLE: [
        500,
        'access-control: stored membership has an invalid role',
      ],
      E_ACCESS_CONTROL_INVALID_STORED_STATUS: [
        500,
        'access-control: stored membership has an unsupported status',
      ],
      E_ACCESS_CONTROL_INVALID_STORED_TIMESTAMP: [
        500,
        'A stored membership timestamp is not valid.',
      ],
      E_ACCESS_CONTROL_AUTHENTICATION_REQUIRED: [
        403,
        'Authentication is required to enter this scope.',
      ],
      E_ACCESS_CONTROL_MEMBERSHIP_REQUIRED: [403, 'A membership is required to do that.'],
      E_ACCESS_CONTROL_MEMBERSHIP_SUSPENDED: [403, 'A suspended membership cannot do that.'],
      E_ACCESS_CONTROL_PERMISSION_DENIED: [403, 'You do not have permission to do that.'],
      E_ACCESS_CONTROL_UNKNOWN_PERMISSION: [403, 'That permission does not exist.'],
      E_ACCESS_CONTROL_OWNER_REQUIRED: [403, 'Only the active owner can transfer ownership.'],
      E_ACCESS_CONTROL_IDENTITY_TARGET_HAS_NO_MEMBERSHIPS: [
        403,
        'The target account has no memberships.',
      ],
    }

    assert.sameMembers(Object.keys(errors), Object.keys(expected))
    assert.equal(new Set(Object.values(errors)).size, Object.keys(expected).length)
    for (const code of Object.keys(expected) as AccessControlErrorCode[]) {
      const [status, message] = expected[code]
      const Cause = errors[code]
      const error = new Cause()
      assert.equal(Cause.code, code)
      assert.equal(Cause.status, status)
      assert.equal(Cause.message, message)
      assert.equal(error.code, code)
      assert.equal(error.status, status)
      assert.equal(error.message, message)
      assert.match(error.name, /Exception$/)
      assert.instanceOf(error, Cause)
      assert.instanceOf(error, Exception)
    }
  })

  test('carries a detail and cause without letting options replace the class metadata', ({
    assert,
  }) => {
    const cause = new Error('inner')
    const options = { cause, code: 'OTHER', status: 200 }
    const error = new errors.E_ACCESS_CONTROL_INVALID_KEY('Bad scope key', options)
    assert.equal(error.message, 'Bad scope key')
    assert.equal(error.cause, cause)
    assert.equal(error.code, 'E_ACCESS_CONTROL_INVALID_KEY')
    assert.equal(error.status, 422)
  })

  test('a fixed cursor message ignores surplus JavaScript arguments', ({ assert }) => {
    const error = Reflect.construct(errors.E_ACCESS_CONTROL_INVALID_CURSOR, ['Replacement text'])
    assert.equal(error.message, 'Invalid membership cursor')
    assert.deepEqual(error.getHttpResponse(), {
      code: 'E_ACCESS_CONTROL_INVALID_CURSOR',
      status: 422,
      message: 'Invalid membership cursor',
    })
  })

  test('handle writes the status, no-store and the errors body', async ({ assert }) => {
    const { ctx, sent } = fakeContext()
    const error = new errors.E_ACCESS_CONTROL_NOT_A_MEMBER()
    await error.handle(error, ctx as never)
    assert.equal(sent.status, 404)
    assert.equal(sent.headers['Cache-Control'], 'no-store')
    assert.deepEqual(sent.body, {
      errors: [
        {
          code: 'E_ACCESS_CONTROL_NOT_A_MEMBER',
          message: 'That person is not a member of this team.',
        },
      ],
    })
  })

  test('handle translates through ctx.i18n with the English fallback', async ({ assert }) => {
    const seen: unknown[] = []
    const { ctx, sent } = fakeContext({
      t(key, data, fallback) {
        seen.push([key, data, fallback])
        return key === 'errors.E_ACCESS_CONTROL_FORBIDDEN' ? 'Interdit.' : fallback
      },
    })
    const forbidden = new errors.E_ACCESS_CONTROL_INVALID_KEY(
      'Private scope key'
    ).concealScopeFailure('access')
    await forbidden.handle(forbidden, ctx as never)
    assert.equal(forbidden.code, 'E_ACCESS_CONTROL_INVALID_KEY')
    assert.equal(forbidden.status, 422)
    assert.equal(sent.status, 403)
    assert.deepEqual(sent.body, {
      errors: [{ code: 'E_ACCESS_CONTROL_FORBIDDEN', message: 'Interdit.' }],
    })
    assert.deepEqual(seen, [
      ['errors.E_ACCESS_CONTROL_FORBIDDEN', {}, 'You do not have permission to do that.'],
    ])
    const other = new errors.E_ACCESS_CONTROL_LAST_OWNER()
    await other.handle(other, ctx as never)
    assert.deepEqual(sent.body, {
      errors: [
        {
          code: 'E_ACCESS_CONTROL_LAST_OWNER',
          message: 'Transfer ownership before deleting this account.',
        },
      ],
    })
  })
})
