# Management rules

The rules are pure functions on the configuration, exposed on the `AccessControl` instance and
applied by the membership service inside its transactions. `O` is the owner role when set.

## Vocabulary

- `rank(role)`: the position of the role in the tuple, or -1 when the role is unknown.
- `can(role, key)`: the role is known, the key exists and the role ranks at or above the key's
  minimum role.
- `permissionsFor(role)`: every key the role satisfies.
- `assignableRoles(actorRole)`: empty unless the actor has `members:manage`; otherwise every role
  of equal or lower rank, excluding the owner role.

## Managing a member

`canManage({ actorRole, targetRole, isSelf })` decides whether an actor may change a member's role,
change their status or remove them. The first matching row wins.

1. The actor's or the target's role is unknown: denied, `UNKNOWN_ROLE`.
2. The actor is the target: denied, `SELF_MANAGEMENT`. Nobody changes their own role or status.
3. The actor lacks `members:manage`: denied, `FORBIDDEN`.
4. The target is the owner: denied, `OWNER_PROTECTED`.
5. The target ranks above the actor: denied, `RANK_TOO_LOW`.
6. Otherwise allowed. Equal rank is allowed: an admin manages another admin.

## Assigning a role

`canAssign({ actorRole, targetRole, nextRole, isSelf })` runs `canManage` first, then checks the
role being assigned.

1. The next role is unknown: denied, `UNKNOWN_ROLE`.
2. The next role is the owner role: denied, `OWNER_PROTECTED`.
3. The next role ranks above the actor: denied, `RANK_TOO_LOW`.
4. Otherwise allowed.

Adding a member uses `canAssign` with the new role as the target role, so the rows about an
existing target do not apply.

## Acting on yourself

- Changing your own role or status is always `SELF_MANAGEMENT`.
- Leaving a scope is allowed for every member except the owner, who gets `OWNER_PROTECTED`. A
  suspended member may leave.
- The package has no last-manager guarantee when the owner role is unset: the last admin may
  leave or be removed, and the scope keeps its other members. Set `ownerRole` when a scope must
  always have someone in charge.

## Who may administer an identity

Password resets, session revocation and similar actions taken by one user on another are not
scoped, so `canAdministerIdentity(actorRoles, targetRoles, isSelf)` looks at every scope at once.
`actorRoles` holds the actor's active memberships and `targetRoles` every membership of the
target, suspended ones included.

1. A target with no memberships: false.
2. Acting on yourself: true.
3. For every scope of the target, the actor must be a member of that scope and `canManage` must
   allow the actor's role over the target's role there. Any failure: false. A target who owns a
   scope can therefore be administered by nobody but themselves.
4. Otherwise true.

`memberships.assertCanAdministerIdentity({ actorId, targetId })` loads both maps under locks and
throws `E_ACCESS_CONTROL_FORBIDDEN` when the predicate is false. Run it immediately before the
Account Kit operation it guards; the guarantee covers the check, not the moment between the check
and the kit's own transaction.
