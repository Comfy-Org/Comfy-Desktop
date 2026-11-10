const PERFORMANCE_TEST_SESSION_PREFIX = 'performance-test:'

export type SessionKind = 'performance_test' | 'normal'

export function performanceTestSessionKey(installationId: string): string {
  return `${PERFORMANCE_TEST_SESSION_PREFIX}${installationId}`
}

export function sessionKindOf(sessionKey: string): SessionKind {
  return sessionKey.startsWith(PERFORMANCE_TEST_SESSION_PREFIX) ? 'performance_test' : 'normal'
}

export function installationIdOf(sessionKey: string): string {
  return sessionKindOf(sessionKey) === 'performance_test'
    ? sessionKey.slice(PERFORMANCE_TEST_SESSION_PREFIX.length)
    : sessionKey
}
