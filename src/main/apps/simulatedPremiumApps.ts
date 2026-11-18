const SIMULATED_PREMIUM_APP_IDS: ReadonlySet<string> = new Set(['product-swap', 'product-ads'])

export function isSimulatedPremiumApp(id: string): boolean {
  return SIMULATED_PREMIUM_APP_IDS.has(id)
}
