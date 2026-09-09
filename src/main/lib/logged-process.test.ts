import { describe, it, expect } from 'vitest'
import { tailOutput, withOutputTail } from './logged-process'

describe('tailOutput', () => {
  it('returns the last N lines, trimmed', () => {
    const text = ['a', 'b', 'c', 'd', 'e'].join('\n') + '\n\n'
    expect(tailOutput(text, 2)).toBe('d\ne')
  })

  it('returns all lines when fewer than the limit', () => {
    expect(tailOutput('only one line')).toBe('only one line')
  })

  it('returns an empty string for empty or whitespace-only output', () => {
    expect(tailOutput('')).toBe('')
    expect(tailOutput('   \n  \n')).toBe('')
  })
})

describe('withOutputTail', () => {
  it('appends the output tail beneath the prefix', () => {
    expect(withOutputTail('install failed', 'line1\nline2')).toBe('install failed\n\nline1\nline2')
  })

  it('returns the prefix alone when there is no output', () => {
    expect(withOutputTail('install failed', '')).toBe('install failed')
    expect(withOutputTail('install failed', '   \n')).toBe('install failed')
  })

  it('limits the tail to the requested number of lines', () => {
    const output = Array.from({ length: 50 }, (_, i) => `line${i}`).join('\n')
    const result = withOutputTail('failed', output, 3)
    expect(result).toBe('failed\n\nline47\nline48\nline49')
  })
})
