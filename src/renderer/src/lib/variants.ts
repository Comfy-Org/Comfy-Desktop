import type { FieldOption } from '../types/ipc'

export const variantImages: Record<string, string> = {
  nvidia: './images/nvidia-logo.jpg',
  amd: './images/amd-logo.png',
  'intel-xpu': './images/intel-logo.png',
  mps: './images/apple-mps-logo.png'
}

export const variantOrder: string[] = ['amd', 'nvidia', 'intel-xpu', 'cpu', 'mps']

export function stripVariantPrefix(variantId: string): string {
  return variantId.replace(/^(?:beta-)?(win|mac|linux)-/, '')
}

export function getVariantImage(option: FieldOption): string | null {
  const stripped = stripVariantPrefix((option.data?.variantId as string) ?? option.value)
  for (const key of Object.keys(variantImages)) {
    if (stripped === key || stripped.startsWith(key + '-')) return variantImages[key]!
  }
  return null
}

export const variantLabels: Record<string, string> = {
  nvidia: 'NVIDIA',
  amd: 'AMD',
  mps: 'Apple Silicon',
  'intel-xpu': 'Intel Arc',
  cpu: 'CPU'
}

export function getVariantGpuLabel(variantId: string): string | null {
  const stripped = stripVariantPrefix(variantId)
  for (const key of Object.keys(variantLabels)) {
    if (stripped === key || stripped.startsWith(key + '-')) return variantLabels[key]!
  }
  return null
}

export function findBestVariant(
  options: FieldOption[],
  snapshotVariantId: string
): FieldOption | null {
  const recommended = options.find((o) => o.recommended)
  if (recommended) return recommended
  const stripped = stripVariantPrefix(snapshotVariantId)
  const snapshotMatch = stripped
    ? options.find((o) => stripVariantPrefix((o.data?.variantId as string) || '') === stripped)
    : undefined
  return snapshotMatch || options[0] || null
}

export function sortedCardOptions(options: FieldOption[]): FieldOption[] {
  return [...options].sort((a, b) => {
    const aKey = stripVariantPrefix((a.data?.variantId as string) ?? a.value)
    const bKey = stripVariantPrefix((b.data?.variantId as string) ?? b.value)
    const aIdx = variantOrder.findIndex((k) => aKey === k || aKey.startsWith(k + '-'))
    const bIdx = variantOrder.findIndex((k) => bKey === k || bKey.startsWith(k + '-'))
    return (aIdx < 0 ? 999 : aIdx) - (bIdx < 0 ? 999 : bIdx)
  })
}
