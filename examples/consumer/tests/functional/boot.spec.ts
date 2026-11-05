import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'

test.group('Consumer fixture boots with Account Kit', () => {
  test('serves the health route', async ({ client }) => {
    const response = await client.get('/')
    response.assertStatus(200)
    response.assertBodyContains({ status: 'ok' })
  })

  test('migrated the Account Kit transaction lock row', async ({ assert }) => {
    const row = await db.from('account_transaction_lock').where('id', 1).first()
    assert.isDefined(row)
  })
})
