import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'home': { paramsTuple?: []; params?: {} }
    'new_account.create': { paramsTuple?: []; params?: {} }
    'new_account.store': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'password_resets.create': { paramsTuple?: []; params?: {} }
    'password_resets.store': { paramsTuple?: []; params?: {} }
    'email_verifications.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'email_verifications.update': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password_resets.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password_resets.update': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'email_changes.confirm': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'email_changes.complete': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'email_verifications.store': { paramsTuple?: []; params?: {} }
    'profile.edit': { paramsTuple?: []; params?: {} }
    'profile.update': { paramsTuple?: []; params?: {} }
    'passwords.edit': { paramsTuple?: []; params?: {} }
    'passwords.update': { paramsTuple?: []; params?: {} }
    'email_changes.edit': { paramsTuple?: []; params?: {} }
    'email_changes.store': { paramsTuple?: []; params?: {} }
    'email_changes.cancel': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'account': { paramsTuple?: []; params?: {} }
    'invitations.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'invitations.update': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'teams.index': { paramsTuple?: []; params?: {} }
    'teams.store': { paramsTuple?: []; params?: {} }
    'teams.show': { paramsTuple: [ParamValue]; params: {'scopeId': ParamValue} }
    'teams.update': { paramsTuple: [ParamValue]; params: {'scopeId': ParamValue} }
    'team_invitations.store': { paramsTuple: [ParamValue]; params: {'scopeId': ParamValue} }
  }
  GET: {
    'home': { paramsTuple?: []; params?: {} }
    'new_account.create': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'password_resets.create': { paramsTuple?: []; params?: {} }
    'email_verifications.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password_resets.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'email_changes.confirm': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'profile.edit': { paramsTuple?: []; params?: {} }
    'passwords.edit': { paramsTuple?: []; params?: {} }
    'email_changes.edit': { paramsTuple?: []; params?: {} }
    'account': { paramsTuple?: []; params?: {} }
    'invitations.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'teams.index': { paramsTuple?: []; params?: {} }
    'teams.show': { paramsTuple: [ParamValue]; params: {'scopeId': ParamValue} }
  }
  HEAD: {
    'home': { paramsTuple?: []; params?: {} }
    'new_account.create': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'password_resets.create': { paramsTuple?: []; params?: {} }
    'email_verifications.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password_resets.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'email_changes.confirm': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'profile.edit': { paramsTuple?: []; params?: {} }
    'passwords.edit': { paramsTuple?: []; params?: {} }
    'email_changes.edit': { paramsTuple?: []; params?: {} }
    'account': { paramsTuple?: []; params?: {} }
    'invitations.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'teams.index': { paramsTuple?: []; params?: {} }
    'teams.show': { paramsTuple: [ParamValue]; params: {'scopeId': ParamValue} }
  }
  POST: {
    'new_account.store': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'password_resets.store': { paramsTuple?: []; params?: {} }
    'email_verifications.update': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password_resets.update': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'email_changes.complete': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'email_verifications.store': { paramsTuple?: []; params?: {} }
    'profile.update': { paramsTuple?: []; params?: {} }
    'passwords.update': { paramsTuple?: []; params?: {} }
    'email_changes.store': { paramsTuple?: []; params?: {} }
    'email_changes.cancel': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'invitations.update': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'teams.store': { paramsTuple?: []; params?: {} }
    'teams.update': { paramsTuple: [ParamValue]; params: {'scopeId': ParamValue} }
    'team_invitations.store': { paramsTuple: [ParamValue]; params: {'scopeId': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}