# User story catalogue

Source baseline: `a20701e4e5ee4fe009a06ceb5c7614b4621ea357` (origin/main, 2026-11-12). Scope: exported configuration/rules/membership API, provider and setup, scope middleware, Bouncer abilities, client payload, and Account Kit callbacks. Source-reviewed only; no runtime journeys were exercised for this catalogue.

## Index

| Story                                                            | Action                                            | Status   |
| ---------------------------------------------------------------- | ------------------------------------------------- | -------- |
| [US-ACCESS-01](US-ACCESS-01-define-role-matrix.md)               | Declare ordered roles and permission keys         | Current  |
| [US-ACCESS-02](US-ACCESS-02-enter-scoped-route.md)               | Enter an authorized team-scoped route             | Current  |
| [US-ACCESS-03](US-ACCESS-03-add-member.md)                       | Add a member to a scope                           | Current  |
| [US-ACCESS-04](US-ACCESS-04-change-member-role.md)               | Change a member's role                            | Current  |
| [US-ACCESS-05](US-ACCESS-05-change-member-status.md)             | Suspend or reactivate a member                    | Current  |
| [US-ACCESS-06](US-ACCESS-06-remove-member.md)                    | Remove a member from a scope                      | Current  |
| [US-ACCESS-07](US-ACCESS-07-leave-scope.md)                      | Leave a scope                                     | Current  |
| [US-ACCESS-08](US-ACCESS-08-transfer-ownership.md)               | Transfer scope ownership                          | Current  |
| [US-ACCESS-09](US-ACCESS-09-invite-member.md)                    | Invite a person to a scope                        | Current  |
| [US-ACCESS-10](US-ACCESS-10-accept-invitation.md)                | Accept a scoped invitation                        | Current  |
| [US-ACCESS-11](US-ACCESS-11-administer-account-identity.md)      | Apply cross-scope identity administration rules   | Current  |
| [US-ACCESS-12](US-ACCESS-12-share-client-permissions.md)         | Send effective membership permissions to a client | Current  |
| [US-ACCESS-13](US-ACCESS-13-integrate-account-lifecycle.md)      | Export membership data with account records       | Current  |
| [US-ACCESS-14](US-ACCESS-14-configure-access-control.md)         | Configure Access Control                          | Operator |
| [US-ACCESS-15](US-ACCESS-15-adopt-existing-memberships.md)       | Adopt existing membership data                    | Operator |
| [US-ACCESS-16](US-ACCESS-16-list-members.md)                     | Review a paginated scope member list              | Current  |
| [US-ACCESS-17](US-ACCESS-17-manage-pending-invitations.md)       | List pending invitations                          | Current  |
| [US-ACCESS-18](US-ACCESS-18-apply-trusted-membership-changes.md) | Grant a membership after application approval     | Current  |
| [US-ACCESS-19](US-ACCESS-19-view-my-memberships.md)              | View scopes I belong to                           | Current  |
| [US-ACCESS-20](US-ACCESS-20-protect-account-deletion.md)         | Protect scope ownership during account deletion   | Current  |
| [US-ACCESS-21](US-ACCESS-21-bootstrap-first-member.md)           | Bootstrap the first member of a scope             | Current  |
| [US-ACCESS-22](US-ACCESS-22-diagnose-installation.md)            | Diagnose the Access Control installation          | Operator |
| [US-ACCESS-23](US-ACCESS-23-resend-invitation.md)                | Resend a pending invitation                       | Current  |
| [US-ACCESS-24](US-ACCESS-24-revoke-invitation.md)                | Revoke a pending invitation                       | Current  |
| [US-ACCESS-25](US-ACCESS-25-delete-scope-memberships.md)         | Remove memberships when deleting a scope          | Current  |

## Files

- [Template and maintenance rules](TEMPLATE.md)
- [Actors, boundaries and source map](REFERENCE.md)
- [Capability coverage](COVERAGE.md)
- [Decision gaps](GAPS.md)
