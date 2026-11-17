export const TEMPLATE_SEARCH_MAX_QUERY = 2000

export function opensInAWindow(launchMode: unknown): boolean {
  return (launchMode ?? 'window') === 'window'
}
