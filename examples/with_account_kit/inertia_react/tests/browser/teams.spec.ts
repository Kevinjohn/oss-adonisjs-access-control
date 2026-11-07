import { test } from '@japa/runner'
import limiter from '@adonisjs/limiter/services/main'
import User from '#models/user'
import { setupAccountDatabase } from '#tests/helpers/account_database'

const password = 'TeamsPass123!'

test.group('teams in the browser', (group) => {
  group.each.setup(async () => {
    const cleanup = await setupAccountDatabase()
    await limiter.clear(['memory'])
    return cleanup
  })

  test('an account creates a team, renames it and sees itself as owner', async ({ visit }) => {
    await User.create({ email: 'owner@example.test', password })

    const page = await visit('/login')
    await page.getByLabel('Email').fill('owner@example.test')
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('heading', { name: 'Your dashboard is ready' }).waitFor()

    await page.getByRole('link', { name: 'Teams' }).click()
    await page.getByLabel('Team name').fill('Rockets')
    await page.getByRole('button', { name: 'Create team' }).click()
    await page.getByRole('heading', { name: 'Rockets' }).waitFor()
    await page.getByText('owner@example.test (owner)').waitFor()

    await page.getByLabel('Team name').fill('Comets')
    await page.getByRole('button', { name: 'Rename team' }).click()
    await page.getByRole('heading', { name: 'Comets' }).waitFor()
    await page.getByRole('button', { name: 'Send invitation' }).waitFor()
  })
})
