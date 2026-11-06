import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import {
  executedTests,
  planChangedChecks,
  type ChangedFile,
  type PlannedCheckStep,
} from '../../bin/check_changed_plan.js'
import { repoRoot } from '../helpers/tracked_markdown.js'

const changed = (...paths: string[]): ChangedFile[] =>
  paths.map((path) => ({ path, deleted: false }))

function ran(plan: PlannedCheckStep[]): Record<string, string[]> {
  return Object.fromEntries(
    plan.flatMap((step) => ('command' in step ? [[step.label, step.command]] : []))
  )
}

test('a changed spec runs on its own and requires executed tests', ({ assert }) => {
  const plan = planChangedChecks(changed('tests/rules.spec.ts'))
  const tests = plan.find((step) => step.label === 'tests')

  assert.deepEqual(Object.keys(ran(plan)), ['format', 'lint', 'typecheck', 'tests'])
  assert.deepInclude(tests, {
    command: ['pnpm', 'quick:test', '--files=tests/rules.spec.ts'],
    countsTests: true,
    requiresTests: true,
  })
})

test('package source and manifests run the suite, build and built exports', ({ assert }) => {
  for (const path of ['src/rules.ts', 'package.json', 'pnpm-lock.yaml']) {
    const commands = ran(planChangedChecks(changed(path, 'tests/rules.spec.ts')))
    assert.deepEqual(commands.tests, ['pnpm', 'quick:test'], path)
    assert.deepEqual(commands.build, ['pnpm', 'build'], path)
    assert.deepEqual(commands['built exports'], ['pnpm', 'test:built-exports'], path)
  }
})

test('files the specs read run the full suite without building the package', ({ assert }) => {
  for (const path of [
    'tests/helpers/app.ts',
    'CHANGELOG.md',
    '.github/workflows/checks.yml',
    'docs/guide/setup.md',
    'examples/consumer/README.md',
  ]) {
    const commands = ran(planChangedChecks(changed(path)))
    assert.deepEqual(commands.tests, ['pnpm', 'quick:test'], path)
    assert.notProperty(commands, 'build', path)
  }
})

test('lockfile and workspace changes run lint and typecheck', ({ assert }) => {
  for (const path of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    assert.properties(ran(planChangedChecks(changed(path))), ['lint', 'typecheck'], path)
  }
})

test('the docs workflow inputs build the docs and require a clean tree', ({ assert }) => {
  for (const path of [
    'docs/guide/setup.md',
    'typedoc.json',
    'src/rules.ts',
    'index.ts',
    'account_kit/main.ts',
    'stubs/config.stub',
  ]) {
    assert.deepInclude(
      planChangedChecks(changed(path)).find((step) => step.label === 'docs build'),
      { command: ['pnpm', 'docs:build'], requiresCleanTree: true },
      path
    )
  }
  assert.notProperty(ran(planChangedChecks(changed('SECURITY.md'))), 'docs build')
})

test('deleted files select checks but are never passed to tools', ({ assert }) => {
  const commands = ran(
    planChangedChecks([
      { path: 'src/old_module.ts', deleted: true },
      { path: 'tests/old_module.spec.ts', deleted: true },
    ])
  )

  assert.notProperty(commands, 'format')
  assert.deepEqual(commands.typecheck, ['pnpm', 'typecheck'])
  assert.deepEqual(commands.tests, ['pnpm', 'quick:test'])
  assert.notInclude(commands.lint.join(' '), 'old_module')
  assert.deepEqual(
    ran(planChangedChecks([{ path: 'tests/old_module.spec.ts', deleted: true }])).tests,
    ['pnpm', 'quick:test']
  )
})

test('formats only existing files and leaves the lockfile to pnpm', ({ assert }) => {
  const commands = ran(planChangedChecks(changed('README.md', 'pnpm-lock.yaml')))

  assert.deepEqual(commands.format.slice(-1), ['README.md'])
  assert.include(commands.format, '--ignore-unknown')
  assert.include(commands.format, '--no-error-on-unmatched-pattern')
})

test('formatter configuration checks the whole tree', ({ assert }) => {
  for (const path of ['.prettierignore', '.editorconfig', 'package.json'])
    assert.deepEqual(ran(planChangedChecks(changed(path))).format, ['pnpm', 'format:check'], path)
})

test('lint allows no warnings and skips files ESLint ignores', async ({ assert }) => {
  assert.deepEqual(ran(planChangedChecks(changed('middleware/main.ts'))).lint, ['pnpm', 'lint'])
  // The repository's own lint script carries the zero-warning limit for every caller.
  const manifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
  assert.include(manifest.scripts.lint, '--max-warnings 0')
  assert.notProperty(ran(planChangedChecks(changed('examples/consumer/app/x.ts'))), 'lint')
})

test('database code notes the PostgreSQL and MySQL suites', ({ assert }) => {
  const note = {
    label: 'database suites',
    skip: 'run pnpm test:pg and pnpm test:mysql for lock, migration or database changes',
  }

  for (const path of [
    'src/memberships.ts',
    'src/locks.ts',
    'stubs/migrations/access_control_create_memberships.stub',
    'tests/helpers/schema.ts',
  ])
    assert.deepInclude(planChangedChecks(changed(path)), note, path)
  assert.notDeepInclude(planChangedChecks(changed('src/rules.ts')), note)
})

test('consumer inputs note the packed consumer', ({ assert }) => {
  const note = {
    label: 'packed consumer',
    skip: 'run pnpm test:consumer --database=sqlite, or pnpm check --full',
  }

  for (const path of [
    'examples/consumer/start/routes.ts',
    'account_kit/main.ts',
    'bin/test_consumer.ts',
    'bin/helpers/consumer_process.ts',
    'configure.ts',
  ])
    assert.deepInclude(planChangedChecks(changed(path)), note, path)
  assert.notDeepInclude(planChangedChecks(changed('docs/guide/setup.md')), note)
})

test('--static names each selected suite in a skip line instead of running it', ({ assert }) => {
  const plan = planChangedChecks(changed('src/rules.ts', 'package.json', 'docs/guide/setup.md'), {
    static: true,
  })

  assert.deepEqual(Object.keys(ran(plan)), ['format', 'lint', 'typecheck', 'docs build'])
  for (const [label, skip] of [
    ['test suite', '--static leaves out pnpm quick:test'],
    ['build', '--static leaves out pnpm build'],
    ['built exports', '--static leaves out pnpm test:built-exports'],
  ])
    assert.deepInclude(plan, { label, skip })
})

test('--static still runs the changed specs on their own', ({ assert }) => {
  const plan = planChangedChecks(changed('src/rules.ts', 'tests/rules.spec.ts'), {
    static: true,
  })

  assert.deepEqual(ran(plan).tests, ['pnpm', 'quick:test', '--files=tests/rules.spec.ts'])
  assert.deepInclude(plan, { label: 'test suite', skip: '--static leaves out pnpm quick:test' })
  assert.deepInclude(planChangedChecks(changed('src/rules.ts'), { static: true }), {
    label: 'tests',
    skip: 'no test files changed',
  })
})

test('--static plans a spec-only change exactly as the default does', ({ assert }) => {
  assert.deepEqual(
    planChangedChecks(changed('tests/rules.spec.ts'), { static: true }),
    planChangedChecks(changed('tests/rules.spec.ts'))
  )
})

test('counts executed tests from the Japa summary', ({ assert }) => {
  assert.equal(executedTests('\u001b[2mTests\u001b[22m  335 passed, 2 skipped (337)'), 335)
  assert.equal(executedTests('Tests  14 passed, 1 failed (15)'), 15)
  assert.equal(executedTests('Tests  1 regression (1)'), 1)
  assert.equal(executedTests('Tests  2 passed, 1 regression, 3 skipped (6)'), 3)
  assert.equal(executedTests(' NO TESTS EXECUTED '), 0)
})

test('the package script runs the check:changed entry point', async ({ assert }) => {
  const scripts = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')).scripts

  assert.equal(
    scripts['check:changed'],
    'node --import=@poppinss/ts-exec --enable-source-maps bin/check_changed.ts'
  )
})
