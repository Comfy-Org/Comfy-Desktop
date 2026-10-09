/** Runtime session keys the Performance Test view launches under, one per installation. */
const PERFORMANCE_TEST_SESSION_PREFIX = 'performance-test:'

export type SessionKind = 'performance_test' | 'normal'

export function performanceTestSessionKey(installationId: string): string {
  return `${PERFORMANCE_TEST_SESSION_PREFIX}${installationId}`
}

export function sessionKindOf(sessionKey: string): SessionKind {
  return sessionKey.startsWith(PERFORMANCE_TEST_SESSION_PREFIX) ? 'performance_test' : 'normal'
}

/** The installation a session key runs: a Performance Test's key carries it after the prefix. */
export function installationIdOf(sessionKey: string): string {
  return sessionKindOf(sessionKey) === 'performance_test'
    ? sessionKey.slice(PERFORMANCE_TEST_SESSION_PREFIX.length)
    : sessionKey
}
