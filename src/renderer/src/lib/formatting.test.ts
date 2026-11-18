import { describe, expect, it } from 'vitest'
import { formatFreeSpace } from './formatting'

const GIB = 1073741824

describe('formatFreeSpace', () => {
  it('shows whole gigabytes below 1000 GB', () => {
    expect(formatFreeSpace(477.97 * GIB)).toBe('478 GB')
  })

  it('switches to terabytes with one decimal from 1000 GB', () => {
    expect(formatFreeSpace(999.6 * GIB)).toBe('1.0 TB')
    expect(formatFreeSpace(1638 * GIB)).toBe('1.6 TB')
  })

  it('falls back to megabytes under 1 GB', () => {
    expect(formatFreeSpace(400 * 1048576)).toBe('400 MB')
  })

  it('never rounds less than 1 GB up to a gigabyte', () => {
    expect(formatFreeSpace(0.6 * GIB)).toBe('614 MB')
    expect(formatFreeSpace(GIB - 1)).toBe('1024 MB')
  })

  it('reads a full disk as 0 MB', () => {
    expect(formatFreeSpace(0)).toBe('0 MB')
  })
})
