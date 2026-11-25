const SPEED_WINDOW_MS = 5000
const SAMPLE_SPACING_MS = 250
const MIN_SPAN_MS = 1000

interface SpeedSample {
  at: number
  bytes: number
}

export interface SpeedMeter {
  record(bytes: number, at: number): void
  read(at: number): number | undefined
  reset(): void
}

export function createSpeedMeter(windowMs = SPEED_WINDOW_MS): SpeedMeter {
  let samples: SpeedSample[] = []

  const prune = (at: number): void => {
    const cutoff = at - windowMs
    while (samples.length > 1 && samples[1]!.at <= cutoff) samples.shift()
  }

  return {
    record(bytes, at) {
      const last = samples.at(-1)
      if (last && bytes < last.bytes) samples = []
      const sample = { at, bytes }
      const beforeLast = samples.at(-2)
      if (beforeLast && at - beforeLast.at < SAMPLE_SPACING_MS) {
        samples[samples.length - 1] = sample
      } else {
        samples.push(sample)
      }
      prune(at)
    },
    read(at) {
      prune(at)
      const anchor = samples[0]
      const latest = samples.at(-1)
      if (!anchor || !latest) return undefined
      const span = at - anchor.at
      if (span < MIN_SPAN_MS) return undefined
      return Math.max(0, ((latest.bytes - anchor.bytes) * 1000) / span)
    },
    reset() {
      samples = []
    }
  }
}
