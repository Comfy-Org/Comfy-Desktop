export type GpuTier = 'high' | 'mid' | 'low' | 'sub_low' | 'apple' | 'cpu_only'

export function deriveGpuTier(opts: {
  vendor: string | null | undefined
  vramGb: number | null | undefined
}): GpuTier {
  const vendor = (opts.vendor ?? '').toLowerCase()
  if (vendor === 'apple' || vendor === 'mps') return 'apple'
  const vram = opts.vramGb ?? 0
  if (!vendor) return 'cpu_only'
  if (vendor !== 'nvidia' && vendor !== 'amd') return 'sub_low'
  if (vram <= 0) return 'cpu_only'
  if (vram >= 24) return 'high'
  if (vram >= 12) return 'mid'
  if (vram >= 6) return 'low'
  return 'sub_low'
}
