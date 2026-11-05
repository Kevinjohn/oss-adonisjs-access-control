# Recipes

Task-focused examples for common Access Control integrations.

## Create a team with its owner

```ts
import db from '@adonisjs/lucid/services/db'
import accessControl from '@kevinjohn/adonisjs-access-control/services/main'

const teamId = await db.transaction(async (trx) => {
  const [team] = await trx.table('teams').returning('id').insert({ name })
  const id = typeof team === 'object' ? team.id : team
  await accessControl.memberships.createFirstMember({ scopeId: id, userId: user.id, trx })
  return id
})
```

With `ownerRole` set the first member becomes the owner; without it pass `role` with a role that
holds `members:manage`.

## Delete a team

```ts
await db.transaction(async (trx) => {
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
  .use([middleware.auth(), middleware.scope()])
```

The response is `{ items, nextCursor }`; pass `nextCursor` back as `cursor` for the next page.

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
