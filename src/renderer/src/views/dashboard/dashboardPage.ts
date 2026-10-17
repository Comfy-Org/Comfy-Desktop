/** What the dashboard's content panel shows: every build, or one build's page. */
export type DashboardPage = { kind: 'all' } | { kind: 'install'; installationId: string }

export const ALL_BUILDS: DashboardPage = { kind: 'all' }

export function installPage(installationId: string): DashboardPage {
  return { kind: 'install', installationId }
}

export function isSamePage(a: DashboardPage, b: DashboardPage): boolean {
  if (a.kind === 'all' || b.kind === 'all') return a.kind === b.kind
  return a.installationId === b.installationId
}
