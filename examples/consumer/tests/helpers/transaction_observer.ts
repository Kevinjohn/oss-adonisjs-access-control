import type { Database } from '@adonisjs/lucid/database'

/**
 * Test-only observation of the statements Knex dispatches on the write client. It keeps the
 * statement kind, leading keyword, table name and Knex correlation identifiers; never other SQL
 * text, bindings, rows or driver messages. The identifiers are Knex 3.3.0 internals: supporting
 * evidence, never proof that a statement ran inside a transaction.
 */
export interface ObservedStatement {
  seq: number
  kind: 'begin' | 'commit' | 'rollback' | 'savepoint' | 'release' | 'query'
  table: string | null
  /** The leading SQL keyword of a `query`, lower-cased; null for transaction control. */
  verb: 'select' | 'insert' | 'update' | 'delete' | 'other' | null
  connectionId: string | null
  transactionId: string | null
  queryId: string | null
  outcome: 'dispatched' | 'succeeded' | 'failed'
  errorCode: string | null
  /** The attempt the statement belongs to, by BEGIN order from 0; null outside every attempt. */
  attempt: number | null
}

/** One BEGIN, the statements dispatched until its COMMIT or ROLLBACK, and that terminal. */
export interface ObservedAttempt {
  begin: ObservedStatement
  terminal: ObservedStatement | null
  inside: ObservedStatement[]
}

/** The attempts in order, with `outside` holding statements dispatched outside every attempt. */
export type ObservedAttempts = ObservedAttempt[] & { outside: ObservedStatement[] }

export interface TransactionObserver {
  statements(): readonly ObservedStatement[]
  attempts(): ObservedAttempts
  detach(): void
}

/** The payload Knex attaches to `query`, `query-response` and `query-error`. */
export interface KnexQueryPayload {
  sql?: string
  __knexUid?: string
  __knexTxId?: string
  __knexQueryUid?: string
}

/** One Knex event, as the observer receives it. */
export type KnexEvent =
  | { event: 'query'; payload: KnexQueryPayload }
  | { event: 'query-response'; payload: KnexQueryPayload }
  | { event: 'query-error'; payload: KnexQueryPayload; code: string | null }

/** A classifier fed by hand: the same state machine `observeTransactions` feeds from Knex. */
export interface StatementClassifier extends TransactionObserver {
  feed(event: KnexEvent): void
}

const control = /^(BEGIN|COMMIT|ROLLBACK)\b/i
// `ROLLBACK TO SAVEPOINT` undoes a savepoint inside the transaction; it does not end it.
const savepoint = /^(SAVEPOINT|ROLLBACK\s+TO)\b/i
const release = /^RELEASE SAVEPOINT\b/i
const tableName = /\b(?:from|into|update)\s+[`"]?([a-zA-Z_][a-zA-Z0-9_]*)/i
const verbs = /^(select|insert|update|delete)\b/i

function kindOf(sql: string): ObservedStatement['kind'] {
  const trimmed = sql.trim()
  if (savepoint.test(trimmed)) return 'savepoint'
  const match = trimmed.match(control)
  if (match) return match[1].toLowerCase() as 'begin' | 'commit' | 'rollback'
  if (release.test(trimmed)) return 'release'
  return 'query'
}

function verbOf(sql: string): ObservedStatement['verb'] {
  const match = sql.trim().match(verbs)
  return match ? (match[1].toLowerCase() as 'select' | 'insert' | 'update' | 'delete') : 'other'
}

/** The statement classifier and attempt state machine, without a database. */
export function classifyForTest(): StatementClassifier {
  const recorded: ObservedStatement[] = []
  const byQueryId = new Map<string, ObservedStatement>()
  let attempt: number | null = null
  let begins = 0

  function feed(input: KnexEvent): void {
    const { payload } = input
    if (typeof payload.__knexUid !== 'string')
      throw new Error(`transaction observer: ${input.event} event without __knexUid`)
    if (input.event === 'query') {
      if (typeof payload.sql !== 'string')
        throw new Error('transaction observer: query event without sql')
      const kind = kindOf(payload.sql)
      const queryId = payload.__knexQueryUid ?? null
      if (kind === 'query' && queryId === null)
        throw new Error('transaction observer: builder query without __knexQueryUid')
      if (queryId !== null && byQueryId.has(queryId))
        throw new Error('transaction observer: repeated __knexQueryUid')
      if (kind === 'begin') attempt = begins++
      const statement: ObservedStatement = {
        seq: recorded.length,
        kind,
        table: kind === 'query' ? (payload.sql.match(tableName)?.[1] ?? null) : null,
        verb: kind === 'query' ? verbOf(payload.sql) : null,
        connectionId: payload.__knexUid,
        transactionId: payload.__knexTxId ?? null,
        queryId,
        outcome: 'dispatched',
        errorCode: null,
        attempt,
      }
      recorded.push(statement)
      if (queryId !== null) byQueryId.set(queryId, statement)
      // COMMIT and ROLLBACK close the interval at dispatch; later SQL is outside it.
      if (kind === 'commit' || kind === 'rollback') attempt = null
      return
    }
    const queryId = payload.__knexQueryUid
    if (queryId === undefined) {
      // Transaction-control SQL has no query id and no response event; only its error is seen.
      if (input.event === 'query-response')
        throw new Error('transaction observer: response without __knexQueryUid')
      const statement = recorded.findLast(
        (s) => s.queryId === null && s.connectionId === payload.__knexUid
      )
      if (!statement || statement.outcome !== 'dispatched')
        throw new Error('transaction observer: control error without its statement')
      statement.outcome = 'failed'
      statement.errorCode = input.code
      return
    }
    const statement = byQueryId.get(queryId)
    if (!statement || statement.outcome !== 'dispatched')
      throw new Error(`transaction observer: unmatched ${input.event}`)
    statement.outcome = input.event === 'query-response' ? 'succeeded' : 'failed'
    if (input.event === 'query-error') statement.errorCode = input.code
  }

  function attempts(): ObservedAttempts {
    const result = Object.assign([] as ObservedAttempt[], { outside: [] as ObservedStatement[] })
    let open: ObservedAttempt | null = null
    for (const statement of recorded) {
      if (statement.kind === 'begin') {
        if (open) throw new Error('transaction observer: BEGIN before the previous terminal')
        open = { begin: statement, terminal: null, inside: [] }
        result.push(open)
      } else if (!open) {
        result.outside.push(statement)
      } else if (statement.kind === 'commit' || statement.kind === 'rollback') {
        open.terminal = statement
        open = null
      } else {
        open.inside.push(statement)
      }
    }
    return result
  }

  return {
    feed,
    statements: () => recorded,
    attempts,
    detach() {
      const missing = recorded.filter((s) => s.kind === 'query' && s.outcome === 'dispatched')
      if (missing.length > 0)
        throw new Error(
          `transaction observer: ${missing.length} query without a response or error (seq ${missing.map((s) => s.seq).join(', ')})`
        )
    },
  }
}

function errorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : null
}

/** Observes the write client of the default connection until `detach`. */
export function observeTransactions(db: Database): TransactionObserver {
  const knex = db.connection().getWriteClient()
  const classifier = classifyForTest()
  const onQuery = (payload: KnexQueryPayload) => classifier.feed({ event: 'query', payload })
  const onResponse = (_response: unknown, payload: KnexQueryPayload) =>
    classifier.feed({ event: 'query-response', payload })
  const onError = (error: unknown, payload: KnexQueryPayload) =>
    classifier.feed({ event: 'query-error', payload, code: errorCode(error) })
  knex.on('query', onQuery)
  knex.on('query-response', onResponse)
  knex.on('query-error', onError)
  let attached = true
  return {
    statements: classifier.statements,
    attempts: classifier.attempts,
    detach() {
      if (attached) {
        knex.off('query', onQuery)
        knex.off('query-response', onResponse)
        knex.off('query-error', onError)
        attached = false
      }
      classifier.detach()
    },
  }
}
