export const NEW_WINDOW_DASHBOARD_PAGES = ['home', 'apps', 'assets', 'chooser'] as const

export type NewWindowDashboardPage = (typeof NEW_WINDOW_DASHBOARD_PAGES)[number]

export function isNewWindowDashboardPage(page: unknown): page is NewWindowDashboardPage {
  return (NEW_WINDOW_DASHBOARD_PAGES as readonly unknown[]).includes(page)
}
