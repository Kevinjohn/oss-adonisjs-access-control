# Capability coverage

“New” means newly documented, not newly implemented. Linked tests are source evidence; no runtime test was run as part of this catalogue.

| Story                                                            | Action                                            | Access                                     | Status   | Catalogue |
| ---------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------ | -------- | --------- |
| [US-ACCESS-01](US-ACCESS-01-define-role-matrix.md)               | Declare ordered roles and permission keys         | Application config author                  | Current  | New       |
| [US-ACCESS-02](US-ACCESS-02-enter-scoped-route.md)               | Enter an authorized team-scoped route             | Effective account with active membership   | Current  | New       |
| [US-ACCESS-03](US-ACCESS-03-add-member.md)                       | Add a member to a scope                           | Active scope manager                       | Current  | New       |
| [US-ACCESS-04](US-ACCESS-04-change-member-role.md)               | Change a member's role                            | Active scope manager                       | Current  | New       |
| [US-ACCESS-05](US-ACCESS-05-change-member-status.md)             | Suspend or reactivate a member                    | Active scope manager                       | Current  | New       |
| [US-ACCESS-06](US-ACCESS-06-remove-member.md)                    | Remove a member from a scope                      | Active scope manager                       | Current  | New       |
| [US-ACCESS-07](US-ACCESS-07-leave-scope.md)                      | Leave a scope                                     | Member except active owner                 | Current  | New       |
| [US-ACCESS-08](US-ACCESS-08-transfer-ownership.md)               | Transfer scope ownership                          | Active owner and eligible target           | Current  | New       |
| [US-ACCESS-09](US-ACCESS-09-invite-member.md)                    | Invite a person to a scope                        | Admitted active manager                    | Current  | New       |
| [US-ACCESS-10](US-ACCESS-10-accept-invitation.md)                | Accept a scoped invitation                        | Valid invitation and canonical scope       | Current  | New       |
| [US-ACCESS-11](US-ACCESS-11-administer-account-identity.md)      | Apply cross-scope identity administration rules   | Management authority in every target scope | Current  | New       |
| [US-ACCESS-12](US-ACCESS-12-share-client-permissions.md)         | Send effective membership permissions to a client | Active effective membership                | Current  | New       |
| [US-ACCESS-13](US-ACCESS-13-integrate-account-lifecycle.md)      | Export membership data with account records       | Account Kit export callback                | Current  | New       |
| [US-ACCESS-14](US-ACCESS-14-configure-access-control.md)         | Configure Access Control                          | Application operator                       | Operator | New       |
| [US-ACCESS-15](US-ACCESS-15-adopt-existing-memberships.md)       | Adopt existing membership data                    | Application operator                       | Operator | New       |
| [US-ACCESS-16](US-ACCESS-16-list-members.md)                     | Review a paginated scope member list              | Active member with members:list            | Current  | New       |
| [US-ACCESS-17](US-ACCESS-17-manage-pending-invitations.md)       | List pending invitations                          | Admitted active invitation manager         | Current  | New       |
| [US-ACCESS-18](US-ACCESS-18-apply-trusted-membership-changes.md) | Grant a membership after application approval     | Host-authorized callback                   | Current  | New       |
| [US-ACCESS-19](US-ACCESS-19-view-my-memberships.md)              | View scopes I belong to                           | Host supplies authenticated user ID        | Current  | New       |
| [US-ACCESS-20](US-ACCESS-20-protect-account-deletion.md)         | Protect scope ownership during account deletion   | Account Kit deletion callback              | Current  | New       |
| [US-ACCESS-21](US-ACCESS-21-bootstrap-first-member.md)           | Bootstrap the first member of a scope             | Trusted scope-creation callback            | Current  | New       |
| [US-ACCESS-22](US-ACCESS-22-diagnose-installation.md)            | Diagnose the Access Control installation          | Application operator                       | Operator | New       |
| [US-ACCESS-23](US-ACCESS-23-resend-invitation.md)                | Resend a pending invitation                       | Admitted active invitation manager         | Current  | New       |
| [US-ACCESS-24](US-ACCESS-24-revoke-invitation.md)                | Revoke a pending invitation                       | Admitted active invitation manager         | Current  | New       |
| [US-ACCESS-25](US-ACCESS-25-delete-scope-memberships.md)         | Remove memberships when deleting a scope          | Trusted host deletion callback             | Current  | New       |

Inventory reconciled: role/rule helpers; membership find/listForUser/listForScope/add/changeRole/setStatus/remove/leave/transferOwnership/createFirstMember/grant/identityRoles/assertCanAdministerIdentity/prepareAccountDeletion/removeAllForScope/exportFor; invitation authorize/accept/list/manage callbacks; scope middleware and resolver; generated Bouncer abilities; client payload; doctor, configure, migration and adoption. Root/subpath exports are mapped in [`index.ts`](../index.ts), [`middleware/main.ts`](../middleware/main.ts) and [`account_kit/main.ts`](../account_kit/main.ts). No prior story catalogue existed.
