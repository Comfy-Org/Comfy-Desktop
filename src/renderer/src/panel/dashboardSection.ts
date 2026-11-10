import type { DashboardPage } from '../types/ipc'

export const DASHBOARD_SECTIONS = ['home', 'apps'] as const

export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number]

export type SidebarPage = DashboardPage | DashboardSection

export function isDashboardSection(page: SidebarPage): page is DashboardSection {
  return (DASHBOARD_SECTIONS as readonly string[]).includes(page)
}
