# Recipes

Task-focused examples for common Access Control integrations. Recipes 6 to 11 come from adopting
the package in [Capacity Lens](https://github.com/Kevinjohn/capacitylens), a single-company
planning application; the links point at its code at revision `68b353794`.

## Contents

1. [Create a team with its owner](#create-a-team-with-its-owner)
2. [Delete a team](#delete-a-team)
3. [Members page with paging](#members-page-with-paging)
4. [Guard a password reset started by an admin](#guard-a-password-reset-started-by-an-admin)
5. [Audit every change](#audit-every-change)
6. [A single-scope application](#a-single-scope-application)
7. [Share one permission declaration with the browser](#share-one-permission-declaration-with-the-browser)
8. [A per-row manage flag](#a-per-row-manage-flag)
9. [Map package errors to your API](#map-package-errors-to-your-api)
10. [A product rule stricter than the package](#a-product-rule-stricter-than-the-package)
11. [Authorize with Bouncer inside the request transaction](#authorize-with-bouncer-inside-the-request-transaction)

## Create a team with its owner

```ts
import db from '@adonisjs/lucid/services/db'
import { transaction } from '@kevinjohn/adonisjs-account-kit/transaction'
import accessControl from '@kevinjohn/adonisjs-access-control/services/main'

const teamId = await transaction(db, async (trx) => {
  const [team] = await trx.table('teams').returning('id').insert({ name })
  const id = typeof team === 'object' ? team.id : team
  await accessControl.memberships.createFirstMember({ scopeId: id, userId: user.id, trx })
  return id
})
```

With `ownerRole` set the first member becomes the owner; without it pass `role` with a role that
holds `members:manage`. Start the transaction with Account Kit's runner, not `db.transaction()`;
the [memberships guide](../guide/memberships.md#transactions-and-locks) says why.

## Delete a team

```ts
await transaction(db, async (trx) => {
  await accessControl.memberships.removeAllForScope({ scopeId, actor: { id: user.id }, trx })
  await trx.from('teams').where('id', scopeId).delete()
})
```

Authorise the deletion yourself before this block. A `E_ACCESS_CONTROL_CONFLICT` means the member
set changed while the rows were being locked; run the transaction again.

## Members page with paging

```ts
router
  .get('/teams/:scopeId/members', async ({ membership, request }) => {
    return accessControl.memberships.listForScope({
      actor: { id: membership!.userId },
      scopeId: membership!.scopeId,
      cursor: request.input('cursor'),
      limit: 50,
    })
  })
  .use([kitAccount, middleware.scope()])
```

The response is `{ items, nextCursor }`; pass `nextCursor` back as `cursor` for the next page.
`kitAccount` is the Account Kit middleware from the [Bouncer guide](../guide/bouncer.md).

## Guard a password reset started by an admin

```ts
await accessControl.memberships.assertCanAdministerIdentity({
  actorId: admin.id,
  targetId: user.id,
})
await accountKit.requestPasswordReset({ email: user.email })
```

The check runs in its own transaction immediately before the kit operation.

## Audit every change

```ts
export default defineAccessControl({
  // ...
  onMembershipChanged: async (event, trx) => {
    await trx.table('membership_audit').insert({ type: event.type, payload: JSON.stringify(event) })
  },
})
```

The row is written in the same transaction as the change and disappears with it on rollback.

## A single-scope application

Some applications serve one company per installation. The scope table still exists and holds one
row, and memberships still name it, but the scope id comes from the application rather than the
URL:

```ts
import type { Trx } from '@kevinjohn/adonisjs-account-kit/types'

/** The installation's company, or null before first setup. */
export async function installationScopeId(client: Pick<Trx, 'from'>): Promise<string | null> {
  const rows = await client.from('companies').select('id').limit(2)
  if (rows.length > 1) throw new Error('This installation holds more than one company.')
  return rows[0] ? String(rows[0].id) : null
}
```

Read the membership with that id inside the request's transaction, as the
[Bouncer recipe](#authorize-with-bouncer-inside-the-request-transaction) below does, instead of
routing through `/teams/:scopeId`. A `resolveScope` passed to the scope middleware must return the
key synchronously, so it fits only when the id is already known, for example cached at boot.

Invitations in such an application usually carry no scope. The package's Account Kit callbacks
refuse and ignore unscoped invitations, so write `authorize` and `onInvitationAccepted` yourself:
resolve the installation scope through the callback's `trx`, check the actor with
`accessControl.can(role, 'invitations:manage')`, and call `memberships.acceptInvitation` with that
scope. Capacity Lens does this in
[`policy.ts`](https://github.com/Kevinjohn/capacitylens/blob/68b353794/apps/backend/app/services/account_kit/policy.ts).

## Share one permission declaration with the browser

When the server and the browser share a workspace package, the declaration can live there once.
The server builds the package configuration from it, and the browser evaluates the same object to
show or hide controls:

```ts
// packages/shared/src/access.ts: plain data, no server imports
export const roles = ['viewer', 'editor', 'admin', 'owner'] as const
type Role = (typeof roles)[number]

export const permissions = {
  project: { read: 'viewer', write: 'editor' },
  members: { list: 'admin', manage: 'admin' },
  invitations: { manage: 'admin' },
} as const satisfies Record<string, Record<string, Role>>

type Permissions = typeof permissions
export type PermissionKey = {
  [R in keyof Permissions]: `${R}:${keyof Permissions[R] & string}`
}[keyof Permissions]

/** For showing controls only. The server decides every request. */
export function can(role: Role, key: PermissionKey): boolean {
  const [resource = '', action = ''] = key.split(':')
  // Own-property checks keep keys such as `__proto__:toString` out of the lookup.
  if (!Object.hasOwn(permissions, resource)) return false
  const actions: Record<string, Role | undefined> = permissions[resource as keyof Permissions]
  const lowest = Object.hasOwn(actions, action) ? actions[action] : undefined
  return lowest !== undefined && roles.indexOf(role) >= roles.indexOf(lowest)
}
```

```ts
// config/access_control.ts
import { defineAccessControl } from '@kevinjohn/adonisjs-access-control'
import { permissions, roles } from '@app/shared/access'

export default defineAccessControl({
  roles,
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'string' },
  scope: { table: 'companies', keyType: 'string' },
  permissions,
})
```

The browser imports only the shared module, never the package's root import, which carries
server code. Boot validation still applies to the shared object, so a missing reserved key fails
the server at start.

Both this and the package's [client payload](../guide/client.md) are valid; neither authorises.

- Use the client payload when the frontend lives in another repository, when a user belongs to
  several scopes with different roles, or when the role thresholds should stay on the server. The
  payload lists the current member's keys and assignable roles and is fetched per scope.
- Use a shared declaration when the browser already knows the member's role and both sides build
  from one workspace. It needs no extra endpoint and a renamed key fails both builds at once; the
  whole matrix ships in the bundle.

Capacity Lens keeps its declaration in
[`packages/shared/src/domain/access.ts`](https://github.com/Kevinjohn/capacitylens/blob/68b353794/packages/shared/src/domain/access.ts) and builds
[`config/access_control.ts`](https://github.com/Kevinjohn/capacitylens/blob/68b353794/apps/backend/config/access_control.ts) from it.

## A per-row manage flag

A members page shows actions only on rows the viewer may manage. Compute the flag on the server
with the package's rule, so the client never re-implements it:

```ts
const page = await accessControl.memberships.listForScope({
  actor: { id: membership.userId },
  scopeId: membership.scopeId,
})
return page.items.map((member) => ({
  ...member,
  manage: accessControl.canManage({
    actorRole: membership.role,
    targetRole: member.role,
    isSelf: member.userId === membership.userId,
  }).allowed,
}))
```

`canManage` covers the package's rules: self, owner, rank and `members:manage`. If the application
adds a stricter rule (see [below](#a-product-rule-stricter-than-the-package)), fold it into the
same flag. For the role picker, `accessControl.assignableRoles(membership.role)` lists the roles
the viewer may assign.

## Map package errors to your API

With AdonisJS's default exception handler, package errors render themselves with the status from
the [error reference](../reference/errors.md). An application with its own error shape maps the
codes a user can reach to 4xx and leaves the rest as reported server faults:

```ts
// app/services/access_refusal.ts
import { AccessControlError } from '@kevinjohn/adonisjs-access-control'
import type { AccessControlErrorCode } from '@kevinjohn/adonisjs-access-control/types'

// Unlisted codes (INVALID_INPUT, INVALID_CONFIG, UNKNOWN_ROLE, OWNER_DISABLED, SCOPE_NOT_EMPTY)
// are faults: the application validates its input before calling the package.
const refusals: Partial<Record<AccessControlErrorCode, { status: number; code: string }>> = {
  E_ACCESS_CONTROL_FORBIDDEN: { status: 403, code: 'FORBIDDEN' },
  E_ACCESS_CONTROL_SELF_MANAGEMENT: { status: 403, code: 'FORBIDDEN' },
  E_ACCESS_CONTROL_OWNER_PROTECTED: { status: 403, code: 'FORBIDDEN' },
  E_ACCESS_CONTROL_RANK_TOO_LOW: { status: 403, code: 'FORBIDDEN' },
  E_ACCESS_CONTROL_NOT_A_MEMBER: { status: 404, code: 'NOT_FOUND' },
  E_ACCESS_CONTROL_USER_NOT_FOUND: { status: 404, code: 'NOT_FOUND' },
  E_ACCESS_CONTROL_SCOPE_NOT_FOUND: { status: 404, code: 'NOT_FOUND' },
  E_ACCESS_CONTROL_ALREADY_MEMBER: { status: 409, code: 'CONFLICT' },
  E_ACCESS_CONTROL_LAST_OWNER: { status: 409, code: 'LAST_OWNER' },
  E_ACCESS_CONTROL_CONFLICT: { status: 409, code: 'CONFLICT' },
}

export function accessRefusal(error: unknown) {
  return error instanceof AccessControlError ? refusals[error.code] : undefined
}
```

```ts
// app/exceptions/handler.ts
async handle(error: unknown, ctx: HttpContext) {
  const refusal = accessRefusal(error)
  if (refusal) {
    ctx.response.header('Cache-Control', 'no-store')
    return ctx.response.status(refusal.status).send({ code: refusal.code })
  }
  if (error instanceof AccessControlError) {
    return ctx.response.internalServerError({ code: 'SERVER_ERROR' })
  }
  return super.handle(error, ctx)
}

async report(error: unknown, ctx: HttpContext) {
  if (accessRefusal(error)) return
  if (error instanceof AccessControlError) {
    // The base handler skips 422, so INVALID_INPUT would otherwise go unlogged.
    return ctx.logger.error({ err: error }, error.message)
  }
  return super.report(error, ctx)
}
```

Collapsing the four management refusals into one 403, as here, keeps the response from saying
which rule refused. Validate request input before the package: roles against `roles`, statuses,
paging limits, and route parameters against the key limits. String keys are 1 to 254 characters,
so bound those parameters where routes are declared and a longer value matches no route:

```ts
// start/routes.ts
for (const param of ['scopeId', 'userId']) router.where(param, /^.{1,254}$/)
```

The paging `cursor` is the one input you cannot validate first: it is opaque, and a client can
send it back altered. Catch `INVALID_INPUT` around `listForScope` so a bad cursor answers 400
instead of reaching the handler as a fault:

```ts
router
  .get('/teams/:scopeId/members', async ({ membership, request, response }) => {
    try {
      return await accessControl.memberships.listForScope({
        actor: { id: membership!.userId },
        scopeId: membership!.scopeId,
        cursor: request.input('cursor'),
        limit: 50,
      })
    } catch (error) {
      if (error instanceof AccessControlError && error.code === 'E_ACCESS_CONTROL_INVALID_INPUT') {
        return response.badRequest({ code: 'INVALID_CURSOR' })
      }
      throw error
    }
  })
  .use([kitAccount, middleware.scope()])
```

The scope key and `limit` come from the server here, so a bad cursor is the only way this call
answers `INVALID_INPUT`.

Capacity Lens maps its codes in
[`refusal.ts`](https://github.com/Kevinjohn/capacitylens/blob/68b353794/apps/backend/app/services/access_control/refusal.ts), handles them in
[`handler.ts`](https://github.com/Kevinjohn/capacitylens/blob/68b353794/apps/backend/app/exceptions/handler.ts) and bounds its parameters in
[`start/routes.ts`](https://github.com/Kevinjohn/capacitylens/blob/68b353794/apps/backend/start/routes.ts).

## A product rule stricter than the package

When the product needs a rule the package does not have, add one line beside the package call,
in the same transaction, with a comment that names the gap:

```ts
const member = await accessControl.memberships.find(scopeId, userId, trx)
if (!member) throw new MemberError(404, 'NOT_FOUND')
// The package changes a suspended member's role; this product changes active members only.
if (member.status !== 'active') throw new MemberError(403, 'FORBIDDEN')
await accessControl.memberships.changeRole({ actor: { id: actorId }, scopeId, userId, role, trx })
```

Capacity Lens has two such rules: role changes only for active members
([`member_mutations.ts`](https://github.com/Kevinjohn/capacitylens/blob/68b353794/apps/backend/app/services/membership/member_mutations.ts)) and
ownership only to an Admin
([`ownership_transfer.ts`](https://github.com/Kevinjohn/capacitylens/blob/68b353794/apps/backend/app/services/membership/ownership_transfer.ts)).
The check reads before the package takes its locks, so it narrows the common case; the package's
own invariants still hold under concurrency.

Audit rows, revision counters and idempotency receipts stay in the application, written through
the same `trx` or from `onMembershipChanged`. The package owns memberships and their invariants
and does not re-check what the application adds.

## Authorize with Bouncer inside the request transaction

When a request does its work in a transaction, read the membership through that transaction and
check permission keys with a Bouncer built for it, so the check and the writes see the same data:

```ts
import { Bouncer } from '@adonisjs/bouncer'
import db from '@adonisjs/lucid/services/db'
import { transaction } from '@kevinjohn/adonisjs-account-kit/transaction'
import accessControl from '#config/access_control'

await transaction(db, async (trx) => {
  const membership = await accessControl.memberships.find(scopeId, user.id, trx)
  const bouncer = new Bouncer(
    user,
    accessControl.abilities(() => membership)
  )
  if (!(await bouncer.allows('project:write'))) throw new ForbiddenError()
  // writes through trx
})
```

`find` does not lock, and the abilities deny a missing or suspended membership. Capacity Lens
does this in
[`authorization.ts`](https://github.com/Kevinjohn/capacitylens/blob/68b353794/apps/backend/app/services/auth/authorization.ts).

Under view-as (Masquerade), build the Bouncer for the effective member, whose membership it is,
and check the real actor's own key separately on the actor's membership:

```ts
const effective = await accessControl.memberships.find(scopeId, effectiveUserId, trx)
const bouncer = new Bouncer(
  { id: effectiveUserId },
  accessControl.abilities(() => effective)
)

const actor = await accessControl.memberships.find(scopeId, actorId, trx)
const mayViewAs = actor?.status === 'active' && accessControl.can(actor.role, 'viewAs:use')
```

A Bouncer built for the actor with the effective member's membership denies every key, because
the abilities refuse a membership that belongs to another user. Capacity Lens builds the effective
Bouncer in [`planning.ts`](https://github.com/Kevinjohn/capacitylens/blob/68b353794/apps/backend/app/services/planning.ts) and checks the actor in
[`auth/masquerade.ts`](https://github.com/Kevinjohn/capacitylens/blob/68b353794/apps/backend/app/services/auth/masquerade.ts).
