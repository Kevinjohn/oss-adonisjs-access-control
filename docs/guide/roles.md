# Roles and permission keys

`config/access_control.ts` declares the roles, the optional owner role, the tables and the
permission keys. Everything else derives from it, and the types follow the declaration.

```ts
import { defineAccessControl } from '@kevinjohn/adonisjs-access-control'

export default defineAccessControl({
  roles: ['viewer', 'editor', 'admin', 'owner'],
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  membershipsTable: 'memberships',
  permissions: {
    project: { read: 'viewer', write: 'editor', archive: 'admin' },
    members: { list: 'admin', manage: 'admin' },
    invitations: { manage: 'admin' },
  },
  onMembershipChanged: async (event, trx) => {},
})
```

## Roles

`roles` is an ordered tuple, lowest first. The position is the rank: a role may manage members
of equal or lower rank and may assign roles of equal or lower rank. Role names are lower-case
identifiers of up to 32 characters (`^[a-z][a-z0-9_-]*$`), unique within the tuple.

`ownerRole`, when set, must be the last role. The owner of a scope is protected: nobody changes,
suspends or removes an owner, nobody assigns the owner role, and the owner cannot leave. Ownership
moves only through `transferOwnership`, which demotes the previous owner to the highest non-owner
role in the same transaction. Without `ownerRole` there is no protected member and no last-manager
guarantee.

## Permission keys

Each key is `resource:action`, built from the nested object: `project: { read: 'viewer' }` becomes
`project:read`. The value names the lowest role allowed; every role of equal or higher rank
satisfies the key. Resource and action names match `^[a-z][a-zA-Z0-9]*$`.

Three keys are required because the package uses them:

| Key                  | Used by                                            |
| -------------------- | -------------------------------------------------- |
| `members:list`       | `memberships.listForScope`                         |
| `members:manage`     | every actor-authorised write and `assignableRoles` |
| `invitations:manage` | the Account Kit `authorize` callbacks              |

Keys are not stored. Renaming a key is a code change, but a frontend reading the
[client payload](client.md) must change in the same deployment.

## Boot validation

The provider resolves the configuration at boot and refuses to start with
`E_ACCESS_CONTROL_INVALID_CONFIG` when the roles, the owner role, a table name, a key type or a
permission value is invalid, or when a required key is missing. Boot never reads the database.

## Deployment contract

Roles are stored by name in the memberships table and in pending Account Kit invitations. A stored
role that is no longer in the tuple is unknown: every check denies it, the scope middleware refuses
the request and the Bouncer abilities return false. Renaming or removing a role, or changing
`ownerRole`, therefore needs a data migration deployed with the configuration change; the
[changing roles guide](changing-roles.md) gives the steps and the doctor command that verifies
them.

## Types

`RoleOf<typeof config>` and `PermissionKeyOf<typeof config>` from
`@kevinjohn/adonisjs-access-control/types` name the role union and the key union of your
configuration, for controllers, frontends and tests. Passing an unknown key to `can`, to a
Bouncer ability or to a permission check is a type error.
