# Adoption record: Capacity Lens

[Capacity Lens](https://github.com/Kevinjohn/capacitylens) is a single-company planning
application: one company per installation, stored as the one scope row. This record notes how it
uses the package and what the package lacked, so later releases can weigh those gaps. It is
evidence from one application, not a usability study.

## Revision

- Capacity Lens `68b353794` (`main`, merge of #1790), with Access Control 0.1.2, Account Kit 0.3.1
  and Masquerade 0.2.1 installed from vendored release tarballs.
- The cutover is [#1787](https://github.com/Kevinjohn/capacitylens/pull/1787); review follow-ups
  are [#1790](https://github.com/Kevinjohn/capacitylens/pull/1790).

## What it uses

- `defineAccessControl` built from a declaration in a shared workspace package, with string keys
  and `ownerRole`.
- The membership service with the caller's transaction: `find`, `listForUser`, `changeRole`,
  `setStatus`, `grant`, `acceptInvitation`, `createFirstMember`, `transferOwnership` and
  `removeAllForScope`.
- Generated abilities in a Bouncer built inside the request transaction, and `canManage` for a
  per-row flag on the members page.
- The memberships table created in the application's unreleased baseline migration.

It does not use the scope middleware, `clientPayload`, `onMembershipChanged`, the package's
Account Kit callbacks or the doctor. The [recipes](../recipes/index.md) from "A single-scope
application" onwards and the [adoption guide](../guide/adopting.md#replacing-a-home-grown-access-layer)
record the patterns.

## What was checked

The application's own gates, as reported in #1787 and #1790: backend functional tests, frontend
tests, end-to-end tests, packaged smoke tests, and mutation checks on the new assertions
(Bouncer route and write keys, the self-role refusal, the per-row flag, the transfer target
rule, the shared `can`, and route parameter bounds). The package's maintainers did not rerun
them.

## What the package lacked

| Gap                                                   | Package behaviour                                                                                                                          | What the application did                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Role changes for suspended members                    | `changeRole` checks that the target exists, not that it is active (`src/memberships.ts`, `changeRole`).                                    | Refuses a non-active target before the call.                                               |
| A state condition answered as invalid input           | `transferOwnership` to a member who is not active throws `INVALID_INPUT` (`src/memberships.ts`, `transferOwnership`).                      | Checks the target first; treats `INVALID_INPUT` as a reported server fault.                |
| A browser-safe `can`                                  | `can` lives on the `AccessControl` instance, whose root import carries server code; the browser gets `clientPayload` or type-only imports. | Evaluates the shared declaration with its own pure `can(role, key)`.                       |
| Single-company applications with unscoped invitations | The Account Kit callbacks refuse and ignore invitations without a scope (`account_kit/main.ts`).                                           | Writes its own `authorize` and `onInvitationAccepted`, resolving the installation's scope. |

None of these is a defect against the [specification](design/spec-access-control.md); each is a
candidate for a future change, to be agreed in an issue first.
