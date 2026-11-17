const dashboardHomePages = ['home', 'apps', 'assets', 'chooser'] as const

export type DashboardHomePage = (typeof dashboardHomePages)[number]

export function isDashboardHomePage(page: unknown): page is DashboardHomePage {
  return dashboardHomePages.some((candidate) => candidate === page)
}
