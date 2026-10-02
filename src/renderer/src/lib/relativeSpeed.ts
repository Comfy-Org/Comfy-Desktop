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

/** Largest log2 distance from the baseline, never below 1 (2× faster or slower). */
export function getRelativeSpeedScale(factors: ReadonlyArray<number | null>): number {
  return Math.max(
    1,
    ...factors.flatMap((factor) =>
      factor === null || factor <= 0 ? [] : [Math.abs(Math.log2(factor))]
    )
  )
}

/** Signed position in [-1, 1] of a factor on a log2 axis spanning ±scale. */
export function getRelativeSpeedOffset(factor: number | null, scale: number): number {
  if (factor === null || factor <= 0) return 0
  return Math.min(1, Math.max(-1, Math.log2(factor) / scale))
}
