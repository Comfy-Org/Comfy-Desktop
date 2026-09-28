export type RelativeSpeedKind = 'faster' | 'baseline' | 'same' | 'slower' | 'missing'

export function calculateRelativeSpeedFactor(
  baselineDuration: number | null,
  duration: number | null
): number | null {
  if (baselineDuration === null || duration === null || baselineDuration <= 0 || duration <= 0) {
    return null
  }
  return baselineDuration / duration
}

export function getRelativeSpeedKind(
  factor: number | null,
  isBaseline: boolean
): RelativeSpeedKind {
  if (factor === null) return 'missing'
  if (isBaseline) return 'baseline'
  if (Math.abs(factor - 1) < 0.005) return 'same'
  return factor > 1 ? 'faster' : 'slower'
}

export function getRelativeSpeedOffset(factor: number | null): number {
  if (factor === null || factor <= 0) return 0
  return Math.min(1, Math.max(-1, Math.log2(factor)))
}
