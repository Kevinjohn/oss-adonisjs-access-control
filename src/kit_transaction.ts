// The transaction runner (specification 0.2): Account Kit's `./transaction` export, which takes
// the kit's SQLite lock row, runs MySQL at READ COMMITTED on a UTC connection and reports commit
// faults, so the package's writes serialise with the kit's own.
import {
  lockRow,
  readTimestamp,
  sqlTimestamp,
  transaction,
} from '@kevinjohn/adonisjs-account-kit/transaction'
import type { TransactionRunner } from './types.js'

/** The runner contract, as `@kevinjohn/adonisjs-account-kit/transaction` exports it. */
export type KitRunner = TransactionRunner

export { lockRow, readTimestamp, sqlTimestamp, transaction }

const runner: KitRunner = Object.freeze({
  source: 'account-kit',
  transaction,
  lockRow,
  sqlTimestamp,
  readTimestamp,
})

/** The runner the provider attaches: Account Kit's transaction helpers. */
export async function loadRunner(): Promise<KitRunner> {
  return runner
}
