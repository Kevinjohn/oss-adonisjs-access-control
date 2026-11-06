import { test } from '@japa/runner'
import { Bouncer } from '@adonisjs/bouncer'
import { HttpContextFactory } from '@adonisjs/core/factories/http'
import type { HttpContext } from '@adonisjs/core/http'
import { AccessControl } from '../index.js'
import ScopeMiddleware, { scopeMiddleware } from '../middleware/main.js'
import { membershipFixture, type MembershipFixture } from './helpers/fixture.js'

/** A request context with the package bound, an optional user and the route's `scopeId`. */
function context(
  f: MembershipFixture,
  user: { id: unknown } | null,
  scopeId: unknown
): HttpContext {
  const ctx = new HttpContextFactory().create()
  ctx.containerResolver.bindValue(AccessControl, f.config as unknown as AccessControl)
  ;(ctx as { auth?: unknown }).auth = { user }
  ctx.params = { scopeId }
  return ctx
}

async function run(
  handler: (ctx: HttpContext, next: () => Promise<unknown>) => Promise<unknown>,
  ctx: HttpContext
): Promise<{ next: boolean; code?: string; status?: number }> {
  let next = false
  try {
    await handler(ctx, async () => {
      next = true
      return 'handled'
    })
    return { next }
  } catch (error) {
    return {
      next,
      code: (error as { code?: string }).code,
      status: (error as { status?: number }).status,
    }
  }
}

const named = (ctx: HttpContext, next: () => Promise<unknown>) =>
  new ScopeMiddleware().handle(ctx, next)

test.group('scope middleware (spec 7)', (group) => {
  let f: MembershipFixture
  let scope: number | string
  let owner: number | string
  let suspended: number | string
  let outsider: number | string
  group.each.setup(async () => {
    f = await membershipFixture()
    scope = await f.createScope()
    ;[owner, suspended, outsider] = await Promise.all([
      f.createUser(),
      f.createUser(),
      f.createUser(),
    ])
    await f.memberships.createFirstMember({ scopeId: scope, userId: owner })
    await f.memberships.add({
      actor: { id: owner },
      scopeId: scope,
      userId: suspended,
      role: 'editor',
    })
    await f.memberships.setStatus({
      actor: { id: owner },
      scopeId: scope,
      userId: suspended,
      status: 'suspended',
    })
    return () => f.cleanup()
  })

  test('a member passes and ctx.membership is set', async ({ assert }) => {
    const ctx = context(f, { id: owner }, String(scope))
    const result = await run(named, ctx)
    assert.deepEqual(result, { next: true })
    assert.deepInclude(ctx.membership, {
      scopeId: scope,
      userId: owner,
      role: 'owner',
      status: 'active',
    })
  })

  test('non-member, suspended, malformed scope, unknown scope and no user are all 403', async ({
    assert,
  }) => {
    const forbidden = { next: false, code: 'E_ACCESS_CONTROL_FORBIDDEN', status: 403 }
    assert.deepEqual(await run(named, context(f, { id: outsider }, scope)), forbidden)
    assert.deepEqual(await run(named, context(f, { id: suspended }, scope)), forbidden)
    assert.deepEqual(await run(named, context(f, { id: owner }, 'abc')), forbidden)
    assert.deepEqual(await run(named, context(f, { id: owner }, undefined)), forbidden)
    assert.deepEqual(await run(named, context(f, { id: owner }, 999_999)), forbidden)
    assert.deepEqual(await run(named, context(f, null, scope)), forbidden)
    assert.deepEqual(await run(named, context(f, { id: 'nope' }, scope)), forbidden)
    const noAuth = context(f, null, scope)
    delete (noAuth as { auth?: unknown }).auth
    assert.deepEqual(await run(named, noAuth), forbidden)
  })

  test('a stored role outside the tuple is 403', async ({ assert }) => {
    await f.db
      .from(f.names.memberships)
      .where({ scope_id: scope, user_id: owner })
      .update({ role: 'ghost' })
    assert.deepEqual(await run(named, context(f, { id: owner }, scope)), {
      next: false,
      code: 'E_ACCESS_CONTROL_FORBIDDEN',
      status: 403,
    })
  })

  test('the named class and scopeMiddleware() behave the same, including resolveScope', async ({
    assert,
  }) => {
    const functional = scopeMiddleware()
    const member = context(f, { id: owner }, scope)
    assert.deepEqual(await run(functional, member), { next: true })
    assert.equal(member.membership?.role, 'owner')
    assert.deepEqual(await run(functional, context(f, { id: outsider }, scope)), {
      next: false,
      code: 'E_ACCESS_CONTROL_FORBIDDEN',
      status: 403,
    })
    const fromHeader = context(f, { id: owner }, 'ignored')
    fromHeader.params = { teamId: scope }
    const custom = scopeMiddleware({ resolveScope: (ctx) => ctx.params.teamId })
    assert.deepEqual(await run(custom, fromHeader), { next: true })
    assert.equal(fromHeader.membership?.scopeId, scope)
    const viaClass = context(f, { id: owner }, 'ignored')
    viaClass.params = { teamId: scope }
    assert.deepEqual(
      await run(
        (ctx, next) =>
          new ScopeMiddleware().handle(ctx, next, { resolveScope: (c) => c.params.teamId }),
        viaClass
      ),
      { next: true }
    )
  })

  test('a route without the middleware has no membership', async ({ assert }) => {
    const ctx = context(f, { id: owner }, scope)
    assert.isUndefined(ctx.membership)
    assert.isUndefined(new HttpContextFactory().create().membership)
  })

  test('the user the kit middleware leaves on ctx.auth is enough: no auth middleware needed', async ({
    assert,
  }) => {
    // Account Kit #770 makes its middleware set ctx.auth.user; the scope middleware reads only that.
    const ctx = context(f, { id: owner }, scope)
    const bouncer = new Bouncer(
      () => ({ id: owner }),
      f.config.abilities(() => ctx.membership)
    )
    assert.isFalse(await bouncer.allows('project:write'))
    assert.deepEqual(await run(named, ctx), { next: true })
    assert.isTrue(await bouncer.allows('project:write'))
    assert.deepEqual(f.config.clientPayload(ctx.membership), {
      scopeId: String(scope),
      role: 'owner',
      permissions: [...f.config.permissionKeys],
      assignableRoles: ['viewer', 'editor', 'admin'],
    })
  })

  test('concurrent requests in different scopes are isolated', async ({ assert }) => {
    const other = await f.createScope()
    await f.memberships.createFirstMember({ scopeId: other, userId: outsider })
    await f.memberships.add({
      actor: { id: outsider },
      scopeId: other,
      userId: owner,
      role: 'viewer',
    })
    const first = context(f, { id: owner }, scope)
    const second = context(f, { id: owner }, other)
    const bouncers = [first, second].map(
      (ctx) =>
        new Bouncer(
          () => ({ id: owner }),
          f.config.abilities(() => ctx.membership)
        )
    )
    await Promise.all([run(named, first), run(named, second)])
    assert.deepEqual(await Promise.all(bouncers.map((b) => b.allows('project:archive'))), [
      true,
      false,
    ])
    assert.equal(first.membership?.role, 'owner')
    assert.equal(second.membership?.role, 'viewer')
  })
})
