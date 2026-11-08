# Scope middleware and Bouncer

A scoped route resolves the current member once, in the `scope` middleware, and then asks Bouncer
about permission keys. Both read the same membership.

## The scope middleware

`configure` registers `scope` as named middleware. Apply it per route or group after Account
Kit's own middleware, never globally:

```ts
import app from '@adonisjs/core/services/app'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { createManagedGuard, managedAccountMiddleware } from '@kevinjohn/adonisjs-account-kit/http'

const kitAccount = managedAccountMiddleware({
  kit: () => app.container.make(AccountKit),
  guard: createManagedGuard({ strategy: 'session', name: 'web', loadUser: async () => User }),
  active: true,
})

router
  .group(() => {
    router.get('/teams/:scopeId/projects', [ProjectsController, 'index'])
  })
  .use([kitAccount, middleware.scope()])
```

The kit's `managedAccountMiddleware` (or `admissionMiddleware` when admission is enabled)
authenticates through your guard and refuses a session whose credential revision is stale, so a
password change or a sign-out everywhere ends access at once; `active: true` also requires an
active, verified account. `middleware.auth()` alone skips those checks: a revoked session would
still reach the scope middleware and the Bouncer abilities.

The middleware reads the user from `ctx.auth.user`, takes the scope from `ctx.params.scopeId` and
loads the membership without locking. It sets `ctx.membership` for the rest of the request. The
request is refused with `E_ACCESS_CONTROL_FORBIDDEN` (403) when there is no user, the scope key is
malformed or unknown, the user is not a member, the membership is suspended, or the stored role is
no longer in the configuration. The response never says which of these applied.

To take the scope from somewhere else, pass a resolver:

```ts
import { scopeMiddleware } from '@kevinjohn/adonisjs-access-control/middleware'

router
  .get('/dashboard', handler)
  .use(scopeMiddleware({ resolveScope: (ctx) => ctx.request.header('x-team') }))
```

The kit middleware leaves the authenticated user on `ctx.auth.user`, which is all the scope
middleware and the Bouncer initializer read; the example consumer's scoped routes run that way.
Under Masquerade the effective guard is the business guard, so the user, the membership and the
Bouncer subject are the same customer.

## Generated abilities

`accessControl.abilities(resolve)` returns one Bouncer ability per permission key, named by the
key. Merge them into the request's Bouncer in `app/middleware/initialize_bouncer_middleware.ts`,
importing the instance from `config/access_control.ts` so the key union is typed (the container
singleton from `services/main` is the same instance, but typed as a bare `AccessControl`, under
which `bouncer.authorize('project:typo')` compiles and throws at runtime):

<!-- source: ../../examples/consumer/app/middleware/initialize_bouncer_middleware.ts#initialize_bouncer -->

```ts
import { Bouncer } from '@adonisjs/bouncer'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import accessControl from '#config/access_control'
import * as abilities from '#abilities/main'
import { policies } from '#policies/main'

/**
 * Builds the per-request Bouncer from the authenticated user and the scope membership. The
 * abilities come from `config/access_control.ts` so their key union is typed; the container
 * singleton from `services/main` is the same instance, typed only as `AccessControl`.
 */
export default class InitializeBouncerMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    ctx.bouncer = new Bouncer(
      () => ctx.auth.user || null,
      { ...abilities, ...accessControl.abilities(() => ctx.membership) },
      policies
    ).setContainerResolver(ctx.containerResolver)
    return next()
  }
}

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    bouncer: Bouncer<
      Exclude<HttpContext['auth']['user'], undefined>,
      typeof abilities & ReturnType<typeof accessControl.abilities>,
      typeof policies
    >
  }
}
```

Each ability resolves the membership when it runs, not when the Bouncer is built, so a membership
set later in the request is seen. It returns false for no membership, a suspended membership, a
membership that belongs to another user than the Bouncer's subject, or a stored role outside the
configuration; otherwise it answers `can(role, key)`. Guests are refused by Bouncer before the
ability runs.

```ts
await bouncer.authorize('project:write') // throws E_AUTHORIZATION_FAILURE (403)
if (await bouncer.allows('members:manage')) {
  /* ... */
}
```

Keys use a colon, so in Edge templates write `@can('project:write')`; the dot form is not
available because Edge reads it as a path.

## Record-level rules

The abilities answer "may this member do this kind of thing in this scope". Whether the member
may touch one particular record stays in your Bouncer policies, which can read `ctx.membership`
for the role and compare the record's `scopeId` with `membership.scopeId`.
