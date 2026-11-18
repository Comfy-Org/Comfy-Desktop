const SIMULATED_PREMIUM_APP_IDS: ReadonlySet<string> = new Set([
  'genjutsu',
  'product-swap',
  'product-ads',
  'remove-background'
])

export function isSimulatedPremiumApp(id: string): boolean {
  return SIMULATED_PREMIUM_APP_IDS.has(id)
}
