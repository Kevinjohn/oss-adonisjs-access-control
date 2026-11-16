import { type KitRelease, kitPackage } from './account_kit_bump.js'

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const version = '(\\d+\\.\\d+\\.\\d+)'
const urlPattern =
  /https:\/\/github\.com\/Kevinjohn\/oss-adonisjs-account-kit\/releases\/download\/v\d+\.\d+\.\d+\/kevinjohn-adonisjs-account-kit-\d+\.\d+\.\d+\.tgz/g

/** Rewrite only live fields owned by the Account Kit release. All observed fields must be source or target. */
export function projectKitFile(
  path: string,
  text: string,
  from: KitRelease,
  to: KitRelease
): string {
  if (path.split('/').pop() === 'CHANGELOG.md') return text
  const isManifest = path.split('/').pop() === 'package.json'
  const isLock = path.split('/').pop() === 'pnpm-lock.yaml'
  const isLedger = path === 'docs/maintainers/requirement-ledger.md'
  const isReadme =
    path === 'README.md' ||
    path === 'README-AGENTS.md' ||
    /^examples\/with_account_kit\/[^/]+\/README\.md$/.test(path)
  const isGuide = path === 'docs/guide/setup.md' || path === 'docs/guide/getting-started.md'
  const isStory = path === 'user-stories/US-ACCESS-28-attach-without-provider.md'
  const isDoctor = path === 'tests/doctor.spec.ts'
  const isProvenance =
    /^(?:src|account_kit|tests)\//.test(path) && !path.startsWith('tests/tooling/')
  if (!isKitBumpPath(path)) return text

  const allowed = (field: string, value: string, source: string, target: string): string => {
    if (value !== source && value !== target)
      throw new Error(`${path}: ${field} has unexpected value ${value}`)
    return target
  }
  let result = text
  const peerKey = escape(kitPackage)
  if (isManifest) {
    const manifest = JSON.parse(text) as Record<string, Record<string, string> | string>
    const sections = ['dependencies', 'devDependencies', 'peerDependencies']
    const needsPeer = path === 'package.json'
    const needsDev = path === 'package.json'
    if (
      needsPeer &&
      !(manifest.peerDependencies as Record<string, string> | undefined)?.[kitPackage]
    )
      throw new Error(`${path}: missing Account Kit peer`)
    if (needsDev && !(manifest.devDependencies as Record<string, string> | undefined)?.[kitPackage])
      throw new Error(`${path}: missing Account Kit dev dependency`)
    for (const section of sections) {
      const value = (manifest[section] as Record<string, string> | undefined)?.[kitPackage]
      if (value === undefined) continue
      const source = section === 'peerDependencies' ? from.version : from.url
      const target = section === 'peerDependencies' ? to.version : to.url
      allowed(`${section}.${kitPackage}`, value, source, target)
    }
    result = result.replace(
      new RegExp(`("${peerKey}"\\s*:\\s*")([^"]+)(")`, 'g'),
      (_whole, prefix: string, value: string, suffix: string) => {
        if (value === from.version || value === to.version)
          return `${prefix}${allowed('peer', value, from.version, to.version)}${suffix}`
        return `${prefix}${allowed('tarball', value, from.url, to.url)}${suffix}`
      }
    )
    return result
  }
  if (isLock) {
    const importer = new RegExp(
      `(^\\s{6}'${peerKey}':\\n\\s{8}specifier: )([^\\n]+)(\\n\\s{8}version: )([^\\n]+)`,
      'gm'
    )
    let importerCount = 0
    result = result.replace(
      importer,
      (_whole, p1: string, spec: string, p2: string, resolved: string) => {
        importerCount++
        allowed('importer specifier', spec, from.url, to.url)
        if (!resolved.startsWith(from.url) && !resolved.startsWith(to.url))
          throw new Error(`${path}: importer resolved version has unexpected value ${resolved}`)
        return `${p1}${to.url}${p2}${resolved.replace(resolved.startsWith(from.url) ? from.url : to.url, to.url)}`
      }
    )
    if (!importerCount) throw new Error(`${path}: missing Account Kit importer`)
    const kitBlock = new RegExp(
      `(^  '${peerKey}@)([^\\n']+)(':\\n    resolution: \\{integrity: )([^,}]+)(, tarball: )([^}]+)(\\}\\n    version: )([^\\n]+)`,
      'm'
    )
    let blockCount = 0
    result = result.replace(
      kitBlock,
      (
        _whole,
        prefix: string,
        keyUrl: string,
        middle1: string,
        integrity: string,
        middle2: string,
        tarball: string,
        middle3: string,
        resolvedVersion: string
      ) => {
        blockCount++
        allowed('package key', keyUrl, from.url, to.url)
        allowed('package integrity', integrity, from.integrity, to.integrity)
        allowed('package tarball', tarball, from.url, to.url)
        allowed('package resolved version', resolvedVersion, from.version, to.version)
        return `${prefix}${to.url}${middle1}${to.integrity}${middle2}${to.url}${middle3}${to.version}`
      }
    )
    if (blockCount !== 1) throw new Error(`${path}: missing Account Kit package resolution`)
    const peer = new RegExp(`(^\\s{6}'${peerKey}': )(${version})$`, 'gm')
    let peerCount = 0
    result = result.replace(peer, (_whole, prefix: string, value: string) => {
      peerCount++
      return prefix + allowed('Access Control peer', value, from.version, to.version)
    })
    if (!peerCount && path !== 'pnpm-lock.yaml')
      throw new Error(`${path}: missing Access Control Kit peer`)
  }
  if (isLedger) {
    const start = result.search(/^\*\*Matrix status:\*\*/m)
    if (start !== -1) {
      const nextBlank = result.indexOf('\n\n', start)
      const end = nextBlank === -1 ? result.length : nextBlank
      const paragraph = result
        .slice(start, end)
        .replace(new RegExp(version, 'g'), (value) =>
          allowed('matrix version', value, from.version, to.version)
        )
      result = result.slice(0, start) + paragraph + result.slice(end)
    }
  }
  if (isReadme || isGuide || isStory) {
    // Contextual mentions include the example tree link and its nearby release spelling.
    result = result.replace(/Account Kit\s+(?:0\.\d+\.\d+|\d+\.\d+\.\d+)/g, (match) =>
      match.replace(new RegExp(version), (value) =>
        allowed('live Account Kit version', value, from.version, to.version)
      )
    )
    if (isReadme && path.startsWith('examples/')) {
      result = result.replace(
        /oss-adonisjs-account-kit\/tree\/v(\d+\.\d+\.\d+)/g,
        (_whole, value: string) =>
          `oss-adonisjs-account-kit/tree/v${allowed('example tree', value, from.version, to.version)}`
      )
      result = result.replace(
        /(?:at `v|`v)(\d+\.\d+\.\d+)(?=`(?: GitHub release)?)/g,
        (whole, value: string) =>
          whole.replace(value, allowed('example release', value, from.version, to.version))
      )
    }
    if (isStory)
      result = result.replace(/exports \((\d+\.\d+\.\d+)\)/g, (whole, value: string) =>
        whole.replace(value, allowed('transaction export version', value, from.version, to.version))
      )
  }
  if (isDoctor) {
    const firstLive = result.indexOf('const versions = accountKitVersions()')
    if (firstLive !== -1) {
      const prefix = result.slice(0, firstLive)
      let live = result.slice(firstLive)
      live = live.replace(
        /(versions\.(?:expected|installed), ')(\d+\.\d+\.\d+)(')/g,
        (_whole, a: string, value: string, b: string) =>
          `${a}${allowed('doctor expected/installed', value, from.version, to.version)}${b}`
      )
      live = live.replace(
        /(expected: ')(\d+\.\d+\.\d+)(')/g,
        (_whole, a: string, value: string, b: string) =>
          `${a}${allowed('doctor expected', value, from.version, to.version)}${b}`
      )
      result = prefix + live
    }
  }
  if (isProvenance) {
    for (const [name, source, target] of [
      ['kitReleaseVersion', from.version, to.version],
      ['kitReleaseSha256', from.sha256, to.sha256],
      ['kitSourceRevision', from.revision, to.revision],
    ]) {
      const field = new RegExp(`(${name}\\s*=\\s*['\"])([^'\"]+)(['\"])`, 'g')
      result = result.replace(
        field,
        (_whole, prefix: string, value: string, suffix: string) =>
          `${prefix}${allowed(name, value, source, target)}${suffix}`
      )
    }
  }
  if (isLock || isReadme || isGuide || isProvenance) {
    result = result.replace(urlPattern, (url) => allowed('release URL', url, from.url, to.url))
  }
  return result
}

export function isKitBumpPath(path: string): boolean {
  if (path.split('/').pop() === 'CHANGELOG.md') return false
  return (
    path.split('/').pop() === 'package.json' ||
    path.split('/').pop() === 'pnpm-lock.yaml' ||
    path === 'docs/maintainers/requirement-ledger.md' ||
    path === 'README.md' ||
    path === 'README-AGENTS.md' ||
    /^examples\/with_account_kit\/[^/]+\/README\.md$/.test(path) ||
    path === 'docs/guide/setup.md' ||
    path === 'docs/guide/getting-started.md' ||
    path === 'user-stories/US-ACCESS-28-attach-without-provider.md' ||
    path === 'tests/doctor.spec.ts' ||
    (/^(?:src|account_kit|tests)\//.test(path) && !path.startsWith('tests/tooling/'))
  )
}
