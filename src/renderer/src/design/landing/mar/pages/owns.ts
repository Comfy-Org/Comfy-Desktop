import { go, type Page } from '../../useProto'

/** The library pages (MarPages.vue). A trailing ':'
 *  takes every page under it (project:…, space:…). Builds, Deployments,
 *  Logs and API keys are the same pages in Create and Build. */
export const MAR_PAGES = [
  'workflows',
  'apps',
  'assets',
  'environments',
  'instances',
  'projects',
  'project:',
  'spaces',
  'space:',
  'settings',
  'favorites',
  'deployments',
  'logs',
  'keys',
  'tool:'
]

export const marOwns = (page: string): boolean =>
  MAR_PAGES.includes(page) || MAR_PAGES.some((p) => p.endsWith(':') && page.startsWith(p))

// Screenshots and the console reach any page, sidebar or not.
;(window as unknown as { __marGo?: (p: string) => void }).__marGo = (p) => go(p as Page)
