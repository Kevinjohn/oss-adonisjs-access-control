# Errors

Catch a specific cause through the root `errors` namespace.

```ts
import { errors } from '@kevinjohn/adonisjs-access-control'

if (error instanceof errors.E_ACCESS_CONTROL_PERMISSION_DENIED) {
  // The member's role does not grant the permission.
}
```

Each class carries a raw `code`, HTTP `status` and default English `message`. An uncaught
exception sets `Cache-Control: no-store` and returns `{ errors: [{ code, message }] }`.
The package asks `ctx.i18n.t('errors.<code>', {}, fallback)` for the response message when the
application supplies a translator.

## Raw codes

| Code                                                  | HTTP | Default English message                                                                 |
| ----------------------------------------------------- | ---- | --------------------------------------------------------------------------------------- |
| `E_ACCESS_CONTROL_NOT_A_MEMBER`                       | 404  | That person is not a member of this team.                                               |
| `E_ACCESS_CONTROL_USER_NOT_FOUND`                     | 404  | That person does not exist.                                                             |
| `E_ACCESS_CONTROL_ALREADY_MEMBER`                     | 409  | That person is already a member of this team.                                           |
| `E_ACCESS_CONTROL_UNKNOWN_ROLE`                       | 422  | That role does not exist.                                                               |
| `E_ACCESS_CONTROL_RANK_TOO_LOW`                       | 403  | You cannot manage someone with a higher role.                                           |
| `E_ACCESS_CONTROL_OWNER_PROTECTED`                    | 409  | The owner cannot be changed, suspended or removed except through an ownership transfer. |
| `E_ACCESS_CONTROL_SELF_MANAGEMENT`                    | 409  | You cannot change your own role or status.                                              |
| `E_ACCESS_CONTROL_OWNER_DISABLED`                     | 409  | This application has no owner role.                                                     |
| `E_ACCESS_CONTROL_LAST_OWNER`                         | 409  | Transfer ownership before deleting this account.                                        |
| `E_ACCESS_CONTROL_SCOPE_NOT_EMPTY`                    | 409  | This team already has members.                                                          |
| `E_ACCESS_CONTROL_SCOPE_NOT_FOUND`                    | 404  | That team does not exist.                                                               |
| `E_ACCESS_CONTROL_CONFLICT`                           | 409  | The team changed while it was being deleted. Try again.                                 |
| `E_ACCESS_CONTROL_INVALID_KEY`                        | 422  | The identifier is not valid.                                                            |
| `E_ACCESS_CONTROL_INVALID_CURSOR`                     | 422  | Invalid membership cursor                                                               |
| `E_ACCESS_CONTROL_INVALID_PAGE_LIMIT`                 | 422  | access-control: limit must be an integer from 1 to 100                                  |
| `E_ACCESS_CONTROL_INVALID_MEMBERSHIP_STATUS`          | 422  | access-control: status must be active or suspended                                      |
| `E_ACCESS_CONTROL_INVALID_INVITATION_SCOPE`           | 422  | The invitation scope must use the canonical spelling.                                   |
| `E_ACCESS_CONTROL_FIRST_MEMBER_MUST_BE_OWNER`         | 422  | access-control: the first member takes the owner role                                   |
| `E_ACCESS_CONTROL_FIRST_MEMBER_ROLE_REQUIRED`         | 422  | access-control: the first member needs a role with members:manage                       |
| `E_ACCESS_CONTROL_FIRST_MEMBER_ROLE_CANNOT_MANAGE`    | 422  | access-control: the first member needs a role with members:manage                       |
| `E_ACCESS_CONTROL_OWNER_ROLE_NOT_GRANTABLE`           | 422  | The owner role cannot be granted directly or through an invitation.                     |
| `E_ACCESS_CONTROL_OWNERSHIP_TARGET_SUSPENDED`         | 422  | access-control: ownership can only go to an active member                               |
| `E_ACCESS_CONTROL_INVALID_STORED_ROLE`                | 500  | access-control: stored membership has an invalid role                                   |
| `E_ACCESS_CONTROL_INVALID_STORED_STATUS`              | 500  | access-control: stored membership has an unsupported status                             |
| `E_ACCESS_CONTROL_INVALID_STORED_TIMESTAMP`           | 500  | A stored membership timestamp is not valid.                                             |
| `E_ACCESS_CONTROL_AUTHENTICATION_REQUIRED`            | 403  | Authentication is required to enter this scope.                                         |
| `E_ACCESS_CONTROL_MEMBERSHIP_REQUIRED`                | 403  | A membership is required to do that.                                                    |
| `E_ACCESS_CONTROL_MEMBERSHIP_SUSPENDED`               | 403  | A suspended membership cannot do that.                                                  |
| `E_ACCESS_CONTROL_PERMISSION_DENIED`                  | 403  | You do not have permission to do that.                                                  |
| `E_ACCESS_CONTROL_UNKNOWN_PERMISSION`                 | 403  | That permission does not exist.                                                         |
| `E_ACCESS_CONTROL_OWNER_REQUIRED`                     | 403  | Only the active owner can transfer ownership.                                           |
| `E_ACCESS_CONTROL_IDENTITY_TARGET_HAS_NO_MEMBERSHIPS` | 403  | The target account has no memberships.                                                  |

An exception may carry a detail and underlying cause. For example,
`new errors.E_ACCESS_CONTROL_INVALID_KEY('Invalid team id', { cause })`.

Invalid developer configuration and calls that omit a required transaction raise AdonisJS
`InvalidArgumentsException`. Service access before initialization raises `RuntimeException`.

## Protected responses

These boundaries keep the original exception for application handling and conceal account,
membership or scope details in the HTTP response.

- Scope middleware maps missing authentication, malformed keys, absent or suspended membership
  and unknown roles to `E_ACCESS_CONTROL_FORBIDDEN` (403).
- `assertCanAdministerIdentity` maps failed identity rules to `E_ACCESS_CONTROL_FORBIDDEN` (403).
- `leave` renders a missing scope as `E_ACCESS_CONTROL_NOT_A_MEMBER` (404), matching an absent
  membership. Its raw code is `E_ACCESS_CONTROL_SCOPE_NOT_FOUND`.

Custom exception handlers can read the projected status, code and English message with
`error.getHttpResponse()`.

Use `E_ACCESS_CONTROL_INVALID_CURSOR` to handle a paging cursor the client has altered.
When ownership transfer raises `E_ACCESS_CONTROL_OWNERSHIP_TARGET_SUSPENDED`, choose an active
recipient. Stored-role, status and timestamp exceptions are deployment faults that require
repairing the membership row. See the [troubleshooting guide](../guide/troubleshooting.md).
