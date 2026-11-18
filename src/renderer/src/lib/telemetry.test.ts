import { describe, it, expect } from 'vitest'
import { toCountBucket, toErrorBucket, toVariantBucket } from './telemetry'

describe('toErrorBucket', () => {
  it('returns "unknown" for empty', () => {
    expect(toErrorBucket('')).toBe('unknown')
  })
  it('detects cancellation', () => {
    expect(toErrorBucket('Operation cancelled by user')).toBe('cancelled')
  })
  it('detects timeout / network / disk / permissions / path', () => {
    expect(toErrorBucket('timeout reached')).toBe('timeout')
    expect(toErrorBucket('fetch failed')).toBe('network')
    expect(toErrorBucket('no disk space')).toBe('disk')
    expect(toErrorBucket('permission denied')).toBe('permissions')
    expect(toErrorBucket('invalid path: missing')).toBe('path')
  })
  it('falls back to "other"', () => {
    expect(toErrorBucket('unexpected boom')).toBe('other')
  })
})

describe('toVariantBucket', () => {
  it('strips the platform prefix', () => {
    expect(toVariantBucket('win-x64-cuda')).toBe('x64-cuda')
    expect(toVariantBucket('mac-arm64-mps')).toBe('arm64-mps')
    expect(toVariantBucket('linux-x64-cpu')).toBe('x64-cpu')
  })
  it('handles missing variant', () => {
    expect(toVariantBucket(undefined)).toBe('unknown')
  })
})

describe('toCountBucket', () => {
  it('buckets common ranges', () => {
    expect(toCountBucket(0)).toBe('0')
    expect(toCountBucket(1)).toBe('1')
    expect(toCountBucket(2)).toBe('2')
    expect(toCountBucket(4)).toBe('3_4')
    expect(toCountBucket(9)).toBe('5_9')
    expect(toCountBucket(50)).toBe('10_plus')
  })
})
