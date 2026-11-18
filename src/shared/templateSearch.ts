export const TEMPLATE_SEARCH_MAX_QUERY = 2000

export const TEMPLATE_SEARCH_EVENT_PREFIX = 'comfy.desktop.template_search.'

export function opensInAWindow(launchMode: unknown): boolean {
  return (launchMode ?? 'window') === 'window'
}
