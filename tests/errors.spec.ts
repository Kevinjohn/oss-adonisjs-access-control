import { test } from '@japa/runner'
import { AccessControlError, errorTable } from '../index.js'
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

test.group('errors: AccessControlError (spec 6)', () => {
  test('every code carries the table status and English message', ({ assert }) => {
    const expected: Record<AccessControlErrorCode, number> = {
      E_ACCESS_CONTROL_FORBIDDEN: 403,
      E_ACCESS_CONTROL_NOT_A_MEMBER: 404,
      E_ACCESS_CONTROL_USER_NOT_FOUND: 404,
      E_ACCESS_CONTROL_ALREADY_MEMBER: 409,
      E_ACCESS_CONTROL_UNKNOWN_ROLE: 422,
      E_ACCESS_CONTROL_RANK_TOO_LOW: 403,
      E_ACCESS_CONTROL_OWNER_PROTECTED: 409,
      E_ACCESS_CONTROL_SELF_MANAGEMENT: 409,
      E_ACCESS_CONTROL_OWNER_DISABLED: 409,
      E_ACCESS_CONTROL_LAST_OWNER: 409,
      E_ACCESS_CONTROL_SCOPE_NOT_EMPTY: 409,
      E_ACCESS_CONTROL_SCOPE_NOT_FOUND: 404,
      E_ACCESS_CONTROL_INVALID_INPUT: 422,
      E_ACCESS_CONTROL_INVALID_CONFIG: 500,
      E_ACCESS_CONTROL_CONFLICT: 409,
    }
    for (const [code, status] of Object.entries(expected) as Array<
      [AccessControlErrorCode, number]
    >) {
      const error = new AccessControlError(code)
      assert.equal(error.code, code)
      assert.equal(error.status, status)
      assert.equal(error.message, errorTable[code].message)
      assert.match(error.message, /^[A-Z].*\.$/)
      assert.instanceOf(error, Error)
    }
    assert.equal(
      new AccessControlError('E_ACCESS_CONTROL_FORBIDDEN').message,
      'You do not have permission to do that.'
    )
    assert.equal(
      new AccessControlError('E_ACCESS_CONTROL_CONFLICT').message,
      'The team changed while it was being deleted. Try again.'
    )
  })

  test('message and cause can be overridden', ({ assert }) => {
    const cause = new Error('inner')
    const error = new AccessControlError('E_ACCESS_CONTROL_INVALID_INPUT', {
      message: 'Bad cursor',
      cause,
    })
    assert.equal(error.message, 'Bad cursor')
    assert.equal(error.cause, cause)
    assert.equal(error.status, 422)
  })

  test('handle writes the status, no-store and the errors body', async ({ assert }) => {
    const { ctx, sent } = fakeContext()
    const error = new AccessControlError('E_ACCESS_CONTROL_NOT_A_MEMBER')
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
    const forbidden = new AccessControlError('E_ACCESS_CONTROL_FORBIDDEN')
    await forbidden.handle(forbidden, ctx as never)
    assert.deepEqual(sent.body, {
      errors: [{ code: 'E_ACCESS_CONTROL_FORBIDDEN', message: 'Interdit.' }],
    })
    assert.deepEqual(seen, [
      ['errors.E_ACCESS_CONTROL_FORBIDDEN', {}, 'You do not have permission to do that.'],
    ])
    const other = new AccessControlError('E_ACCESS_CONTROL_LAST_OWNER')
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
