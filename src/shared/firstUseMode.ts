export type FirstUseMode = 'none' | 'consent-lockdown' | 'post-consent' | 'loading-lockdown'

const VALID: ReadonlySet<FirstUseMode> = new Set<FirstUseMode>([
  'none',
  'consent-lockdown',
  'post-consent',
  'loading-lockdown'
])

export function normaliseFirstUseMode(raw: unknown): FirstUseMode {
  return typeof raw === 'string' && VALID.has(raw as FirstUseMode) ? (raw as FirstUseMode) : 'none'
}

export function isFirstUseLockdownMode(mode: FirstUseMode): boolean {
  return mode === 'consent-lockdown' || mode === 'post-consent'
}

export function isLoadingLockdownMode(mode: FirstUseMode): boolean {
  return mode === 'loading-lockdown'
}

export function isChromeLockedMode(mode: FirstUseMode): boolean {
  return mode !== 'none'
}
