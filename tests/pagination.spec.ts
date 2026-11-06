import { test } from '@japa/runner'
import { decodeCursor, encodeCursor } from '../src/pagination.js'

test.group('pagination: membership cursors', () => {
  test('round-trips created_at and id', ({ assert }) => {
    const cursor = encodeCursor('2026-11-05T10:00:00.000Z', 42)
    assert.match(cursor, /^[A-Za-z0-9_-]+$/)
    assert.deepEqual(decodeCursor(cursor), { createdAt: '2026-11-05T10:00:00.000Z', id: 42 })
  })

  test('rejects anything that is not a canonical cursor', ({ assert }) => {
    const bad = [
      'nope',
      '',
      Buffer.from('[1,2]').toString('base64url'),
      Buffer.from('["2026-11-05T10:00:00.000Z",0]').toString('base64url'),
      Buffer.from('["2026-11-05T10:00:00.000Z",1.5]').toString('base64url'),
      Buffer.from('["not a date",1]').toString('base64url'),
      Buffer.from('["2026-11-05T10:00:00.000Z",1,2]').toString('base64url'),
      Buffer.from('{"a":1}').toString('base64url'),
      encodeCursor('2026-11-05T10:00:00.000Z', 42) + '=',
      'a'.repeat(513),
    ]
    for (const cursor of bad) {
      assert.throws(() => decodeCursor(cursor), /cursor/, JSON.stringify(cursor))
      try {
        decodeCursor(cursor)
      } catch (error) {
        assert.equal((error as { code: string }).code, 'E_ACCESS_CONTROL_INVALID_INPUT')
      }
    }
  })
})
