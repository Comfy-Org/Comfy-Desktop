import { describe, it, expect } from 'vitest'
import { lastNLines, stripAnsi, stripLogLevelPrefix } from './stderrTail'

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi('\u001B[31mError\u001B[0m')).toBe('Error')
  })

  it('removes multiple escape sequences', () => {
    expect(stripAnsi('\u001B[1m\u001B[32mOK\u001B[0m done')).toBe('OK done')
  })

  it('leaves plain text unchanged', () => {
    expect(stripAnsi('no codes here')).toBe('no codes here')
  })
})

describe('stripLogLevelPrefix', () => {
  it('strips a leading [LEVEL] tag (ComfyUI Desktop format)', () => {
    expect(stripLogLevelPrefix('[INFO] Device: cuda:0')).toBe('Device: cuda:0')
    expect(stripLogLevelPrefix('[ERROR] Failed to validate prompt for output 9:')).toBe(
      'Failed to validate prompt for output 9:'
    )
  })

  it('leaves bare lines unchanged (ComfyUI source format)', () => {
    expect(stripLogLevelPrefix('got prompt')).toBe('got prompt')
  })

  it('does not touch a raw Python traceback line', () => {
    expect(stripLogLevelPrefix('Traceback (most recent call last):')).toBe(
      'Traceback (most recent call last):'
    )
  })

  it('only strips a leading tag, not a bracket mid-line', () => {
    expect(stripLogLevelPrefix('model_type [INFO]')).toBe('model_type [INFO]')
  })
})

describe('lastNLines', () => {
  it('returns last 3 lines of a 5-line string', () => {
    const input = 'line1\nline2\nline3\nline4\nline5'
    expect(lastNLines(input, 3)).toBe('line3\nline4\nline5')
  })

  it('returns all lines when n > total lines', () => {
    const input = 'line1\nline2'
    expect(lastNLines(input, 5)).toBe('line1\nline2')
  })

  it('returns empty string for empty input', () => {
    expect(lastNLines('', 3)).toBe('')
  })

  it('handles single line', () => {
    expect(lastNLines('only line', 3)).toBe('only line')
  })
})
