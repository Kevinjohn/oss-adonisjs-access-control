// Compiled against the installed archive by the consumer typecheck, not run as a test.
import { defineConfig, defineAccessControl } from '@kevinjohn/adonisjs-access-control'
import type {
  AccessControlKitCallbacks,
  ScopeMiddlewareOptions,
  DoctorReport,
  MembershipEvent,
  PermissionKeyOf,
  RoleOf,
} from '@kevinjohn/adonisjs-access-control/types'
import type {
  AccessControlKitCallbackOptions,
  ScopeMiddlewareOptions as RootScopeMiddlewareOptions,
} from '@kevinjohn/adonisjs-access-control'
import ScopeMiddleware from '@kevinjohn/adonisjs-access-control/middleware'
import ScopeMiddlewareAlias from '@kevinjohn/adonisjs-access-control/scope_middleware'

const config = defineConfig({
  roles: ['viewer', 'admin'],
  users: { table: 'users', keyType: 'integer' },
  scope: { table: 'teams', keyType: 'integer' },
  permissions: { members: { list: 'viewer', manage: 'admin' }, invitations: { manage: 'admin' } },
})
const sameSignature: typeof defineAccessControl = defineConfig
const scope: typeof ScopeMiddleware = ScopeMiddlewareAlias
const role: RoleOf<typeof config> = 'admin'
const key: PermissionKeyOf<typeof config> = 'members:manage'
// @ts-expect-error literals propagate through the installed alias
const badRole: RoleOf<typeof config> = 'owner'
// @ts-expect-error undeclared permission keys are rejected
const badKey: PermissionKeyOf<typeof config> = 'project:read'
const options: ScopeMiddlewareOptions = { resolveScope: (ctx) => ctx.params.scopeId }
const rootOptions: RootScopeMiddlewareOptions = options
type PublicTypes = [
  DoctorReport,
  AccessControlKitCallbacks,
  AccessControlKitCallbackOptions,
  MembershipEvent<typeof role>,
]
const checks = (types: PublicTypes) => types
void [sameSignature, scope, role, key, badRole, badKey, rootOptions, checks]
