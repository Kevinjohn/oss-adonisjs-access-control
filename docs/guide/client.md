# Client payload

A frontend needs to know what the current member may do without re-implementing the rules.
`accessControl.clientPayload(ctx.membership)` builds that summary:

```ts
router
  .get('/teams/:scopeId/session', async ({ membership }) => {
    return accessControl.clientPayload(membership)
  })
  .use([middleware.auth(), middleware.scope()])
```

```json
{
  "scopeId": "12",
  "role": "editor",
  "permissions": ["project:read", "project:write"],
  "assignableRoles": []
}
```

- `scopeId` is always a string, whatever the key type, so clients compare it as text.
- `permissions` lists every key the role satisfies, in configuration order.
- `assignableRoles` lists the roles the member may assign to others: empty without
  `members:manage`, otherwise every role of equal or lower rank except the owner role.
- `null` comes back for no membership and for a suspended membership.

The payload describes the moment it was built. Decide in the server on every request; the client
uses the payload to show or hide controls, not to authorise.

## Types for the client

Import the shapes type-only, so the frontend bundle carries no server code:

```ts
import type {
  ClientPayload,
  PermissionKeyOf,
  RoleOf,
} from '@kevinjohn/adonisjs-access-control/types'
import type config from '#config/access_control'

type Payload = ClientPayload<RoleOf<typeof config>, PermissionKeyOf<typeof config>>
```

A renamed permission key is a code change on the server and a matching change in every client
reading `permissions`; deploy both together.
