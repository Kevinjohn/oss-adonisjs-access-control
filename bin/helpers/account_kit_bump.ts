/** Release facts used by the Account Kit bump planner. */
export const kitPackage = '@kevinjohn/adonisjs-account-kit'
export const kitRepository = 'https://github.com/Kevinjohn/oss-adonisjs-account-kit'

export interface KitRelease {
  version: string
  url: string
  integrity: string
  sha256: string
  revision: string
}

export function kitReleaseUrl(version: string): string {
  return `${kitRepository}/releases/download/v${version}/kevinjohn-adonisjs-account-kit-${version}.tgz`
}
