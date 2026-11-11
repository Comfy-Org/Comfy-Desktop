const TEMPORARY_LAUNCH_APP_SLUGS = new Set([
  'genjutsu',
  'product-ads',
  'sdr-to-hdr',
  'remove-background',
  'extend-picture'
])

export function isTemporaryLaunchApp(slug: unknown): boolean {
  return typeof slug === 'string' && TEMPORARY_LAUNCH_APP_SLUGS.has(slug)
}
