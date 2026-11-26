# Client membership summary

A frontend needs to know what the current member may do without re-implementing the rules.
`accessControl.buildClientMembership(ctx.membership)` builds that summary (`kitAccount` is the Account
Kit middleware from the [Bouncer guide](bouncer.md)):

```ts
router
  .get('/teams/:scopeId/access', async ({ membership }) => {
    return accessControl.buildClientMembership(membership)
  })
  .use([kitAccount, middleware.scope()])
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
- The helper `buildClientMembership` returns `null` for no
  membership or a suspended membership. The protected example route instead refuses these
  requests with `E_ACCESS_CONTROL_FORBIDDEN` (403) in the scope middleware, before the handler.

The summary contains the scope, role, permissions and assignable roles. The illustrative URL
describes access, not the authentication session; existing applications own compatibility for
their own route paths. The summary describes the moment it was built. Decide on the server on
every request; the client uses the summary to show or hide controls, not to authorise.

## Types for the client

Import the shapes type-only, so the frontend bundle carries no server code:

```ts
import type {
  ClientMembershipSummary,
  PermissionKeyOf,
  RoleOf,
} from '@kevinjohn/adonisjs-access-control/types'
import type config from '#config/access_control'

type MembershipSummary = ClientMembershipSummary<
  RoleOf<typeof config>,
  PermissionKeyOf<typeof config>
>
```

A renamed permission key is a code change on the server and a matching change in every client
reading `permissions`; deploy both together.
