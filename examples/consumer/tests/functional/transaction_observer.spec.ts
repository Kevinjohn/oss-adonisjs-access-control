import { test } from '@japa/runner'
import { classifyForTest, type KnexEvent } from '#tests/helpers/transaction_observer'

const connection = '__knexUid1'

function query(sql: string, txId: string, queryId?: string): KnexEvent {
  return {
    event: 'query',
    payload: { sql, __knexUid: connection, __knexTxId: txId, __knexQueryUid: queryId },
  }
}

function response(txId: string, queryId: string): KnexEvent {
  return {
    event: 'query-response',
    payload: { __knexUid: connection, __knexTxId: txId, __knexQueryUid: queryId },
  }
}

const lock = 'update account_transaction_lock set version = version where id = 1 returning id'

test.group('transaction observer classifier', () => {
  test('reports a query after COMMIT carrying the old transaction id outside the attempt', ({
    assert,
  }) => {
    const observer = classifyForTest()
    for (const event of [
      query('BEGIN;', 'trx1'),
      query(lock, 'trx1', 'q1'),
      response('trx1', 'q1'),
      query('update `memberships` set `role` = ?', 'trx1', 'q2'),
      response('trx1', 'q2'),
      query('COMMIT;', 'trx1'),
      query('select `id` from `users`', 'trx1', 'q3'),
      response('trx1', 'q3'),
    ])
      observer.feed(event)
    const attempts = observer.attempts()
    assert.lengthOf(attempts, 1)
    assert.deepEqual(
      attempts[0].inside.map((s) => s.table),
      ['account_transaction_lock', 'memberships']
    )
    assert.equal(attempts[0].terminal?.kind, 'commit')
    assert.deepEqual(
      attempts.outside.map((s) => ({ table: s.table, transactionId: s.transactionId })),
      [{ table: 'users', transactionId: 'trx1' }]
    )
    assert.isNull(attempts.outside[0].attempt)
    observer.detach()
  })

  test('detach throws for a query without a response or error', ({ assert }) => {
    const observer = classifyForTest()
    observer.feed(query('BEGIN;', 'trx1'))
    observer.feed(query(lock, 'trx1', 'q1'))
    assert.throws(() => observer.detach(), /query without a response or error/)
  })

  test('classifies bare ROLLBACK and ROLLBACK; as rollback', ({ assert }) => {
    const observer = classifyForTest()
    for (const sql of ['BEGIN;', 'ROLLBACK', '  BEGIN;', 'ROLLBACK;'])
      observer.feed(query(sql, 'trx1'))
    assert.deepEqual(
      observer.statements().map((s) => s.kind),
      ['begin', 'rollback', 'begin', 'rollback']
    )
    assert.deepEqual(
      observer.attempts().map((a) => a.terminal?.kind),
      ['rollback', 'rollback']
    )
  })

  test('keeps the attempt open across ROLLBACK TO SAVEPOINT', ({ assert }) => {
    const observer = classifyForTest()
    for (const sql of ['BEGIN;', 'SAVEPOINT trx2;', 'ROLLBACK TO SAVEPOINT trx2', 'COMMIT;'])
      observer.feed(query(sql, 'trx1'))
    const attempts = observer.attempts()
    assert.lengthOf(attempts, 1)
    assert.deepEqual(
      attempts[0].inside.map((s) => s.kind),
      ['savepoint', 'savepoint']
    )
    assert.equal(attempts[0].terminal?.kind, 'commit')
    assert.lengthOf(attempts.outside, 0)
  })

  test('shows a BEGIN without a later lock query in the attempt', ({ assert }) => {
    const observer = classifyForTest()
    for (const event of [
      query('BEGIN;', 'trx1'),
      query('select * from `account_sessions` where `id` = ?', 'trx1', 'q1'),
      response('trx1', 'q1'),
      query('COMMIT;', 'trx1'),
    ])
      observer.feed(event)
    const [attempt] = observer.attempts()
    assert.notInclude(
      attempt.inside.map((s) => s.table),
      'account_transaction_lock'
    )
  })

  test('records a failed query with its code only and rejects overlapping BEGINs', ({ assert }) => {
    const observer = classifyForTest()
    observer.feed(query('BEGIN;', 'trx1'))
    observer.feed(query('insert into `composition_effects` (`stage`) values (?)', 'trx1', 'q1'))
    observer.feed({
      event: 'query-error',
      payload: { __knexUid: connection, __knexTxId: 'trx1', __knexQueryUid: 'q1' },
      code: 'SQLITE_CONSTRAINT',
    })
    const [failed] = observer.attempts()[0].inside
    assert.equal(failed.outcome, 'failed')
    assert.equal(failed.errorCode, 'SQLITE_CONSTRAINT')
    assert.equal(failed.table, 'composition_effects')
    observer.feed(query('BEGIN;', 'trx2'))
    assert.throws(() => observer.attempts(), /BEGIN before the previous terminal/)
    assert.throws(
      () => observer.feed({ event: 'query', payload: { sql: 'select 1' } }),
      /without __knexUid/
    )
  })
})
