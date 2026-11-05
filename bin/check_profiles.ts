/** One `pnpm` script run by `pnpm check`. */
export interface CheckStep {
  script: string
  args?: string[]
  env?: Record<string, string>
}
export type CheckProfile = 'quick' | 'full'

/** Steps per profile. `full` runs after `quick`; together they cover the CI scripts. */
export const checkProfiles: Record<CheckProfile, CheckStep[]> = {
  quick: [
    { script: 'format:check' },
    { script: 'lint' },
    { script: 'typecheck' },
    { script: 'quick:test' },
    { script: 'build' },
    { script: 'test:built-exports' },
  ],
  full: [
    { script: 'test:pg' },
    { script: 'test:mysql' },
    { script: 'test' },
    { script: 'docs:build' },
    { script: 'test:consumer', args: ['--database=sqlite'] },
  ],
}

export function selectedSteps(flags: string[]): CheckStep[] {
  const unknown = flags.filter((flag) => flag !== '--full')
  if (unknown.length > 0) throw new Error(`Use pnpm check [--full]; got ${unknown}`)
  return [...checkProfiles.quick, ...(flags.includes('--full') ? checkProfiles.full : [])]
}
