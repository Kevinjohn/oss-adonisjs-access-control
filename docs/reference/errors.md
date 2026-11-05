# Errors

Every error the package raises is an `AccessControlError` from the root import. Its `code` is one
of the codes below, its `status` the HTTP status, and its default `message` the English text. When
the error reaches the HTTP layer, the package's handler sets the status, `Cache-Control: no-store`
and responds with:

```json
{
  "errors": [
    { "code": "E_ACCESS_CONTROL_FORBIDDEN", "message": "You do not have permission to do that." }
  ]
}
```

With `@adonisjs/i18n` installed, the message is `ctx.i18n.t('errors.<code>', {}, <English message>)`;
the package ships no translations.

| Code                               | HTTP | Message                                                                                 | Raised when                                                                                    |
| ---------------------------------- | ---- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `E_ACCESS_CONTROL_FORBIDDEN`       | 403  | You do not have permission to do that.                                                  | the actor has no active membership, lacks the key, or is not the owner for a transfer          |
| `E_ACCESS_CONTROL_NOT_A_MEMBER`    | 404  | That person is not a member of this team.                                               | the target membership is missing                                                               |
| `E_ACCESS_CONTROL_USER_NOT_FOUND`  | 404  | That person does not exist.                                                             | `add` names a user row that does not exist                                                     |
| `E_ACCESS_CONTROL_ALREADY_MEMBER`  | 409  | That person is already a member of this team.                                           | `add` or `acceptInvitation` on an existing membership                                          |
| `E_ACCESS_CONTROL_UNKNOWN_ROLE`    | 422  | That role does not exist.                                                               | a role outside the configured tuple, including one stored before a config change               |
| `E_ACCESS_CONTROL_RANK_TOO_LOW`    | 403  | You cannot manage someone with a higher role.                                           | the target or the next role ranks above the actor                                              |
| `E_ACCESS_CONTROL_OWNER_PROTECTED` | 409  | The owner cannot be changed, suspended or removed except through an ownership transfer. | the owner is targeted, assigned or tries to leave                                              |
| `E_ACCESS_CONTROL_SELF_MANAGEMENT` | 409  | You cannot change your own role or status.                                              | an actor targets their own membership, or transfers ownership to themselves                    |
| `E_ACCESS_CONTROL_OWNER_DISABLED`  | 409  | This application has no owner role.                                                     | `transferOwnership` without `ownerRole`                                                        |
| `E_ACCESS_CONTROL_LAST_OWNER`      | 409  | Transfer ownership before deleting this account.                                        | `prepareAccountDeletion` for an active owner                                                   |
| `E_ACCESS_CONTROL_SCOPE_NOT_EMPTY` | 409  | This team already has members.                                                          | `createFirstMember` on a scope with members                                                    |
| `E_ACCESS_CONTROL_SCOPE_NOT_FOUND` | 404  | That team does not exist.                                                               | the scope row is missing when the package locks it                                             |
| `E_ACCESS_CONTROL_INVALID_INPUT`   | 422  | The request is not valid.                                                               | malformed keys, limits or cursors; bad trusted-operation input; transfer to a suspended member |
| `E_ACCESS_CONTROL_INVALID_CONFIG`  | 500  | (names the problem)                                                                     | boot validation, a missing database binding, or a missing Account Kit lock row                 |
| `E_ACCESS_CONTROL_CONFLICT`        | 409  | The team changed while it was being deleted. Try again.                                 | `removeAllForScope` saw the member set change between its read and its locks                   |

Construct one with `new AccessControlError(code, { message?, cause? })`; the `errors` namespace
export also carries `errorTable`, the code-to-status-and-message map.
