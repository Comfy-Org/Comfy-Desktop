import { describe, it, expect } from 'vitest'
import { createStreamLineBuffer, lastNLines, stripAnsi, stripLogLevelPrefix } from './stderrTail'

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

  // ComfyUI's ColoredFormatter wraps lines in bold + level color around the
  // [LEVEL] tag, plus an optional whole-message color.
  it('strips ComfyUI ColoredFormatter output', () => {
    expect(stripAnsi('\u001B[1m\u001B[31m[ERROR]\u001B[0m Failed to validate prompt')).toBe(
      '[ERROR] Failed to validate prompt'
    )
    expect(stripAnsi('\u001B[32m[INFO]\u001B[0m \u001B[32mDevice: cuda:0\u001B[0m')).toBe(
      '[INFO] Device: cuda:0'
    )
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

describe('createStreamLineBuffer', () => {
  it('returns only complete lines and carries the unterminated tail', () => {
    const buffer = createStreamLineBuffer()
    expect(buffer.append('stdout', 'first\nsecond\nthi')).toEqual(['first', 'second'])
    expect(buffer.append('stdout', 'rd\n')).toEqual(['third'])
  })

  it('reassembles a line split across three chunk boundaries', () => {
    const buffer = createStreamLineBuffer()
    expect(buffer.append('stdout', 'Device: ')).toEqual([])
    expect(buffer.append('stdout', 'cuda')).toEqual([])
    expect(buffer.append('stdout', ':0\n')).toEqual(['Device: cuda:0'])
  })

  it('splits on CRLF as well as LF', () => {
    const buffer = createStreamLineBuffer()
    expect(buffer.append('stdout', 'a\r\nb\nc\r\n')).toEqual(['a', 'b', 'c'])
  })

  it('keeps stdout and stderr tails from splicing together', () => {
    const buffer = createStreamLineBuffer()
    buffer.append('stdout', 'partial stdout ')
    expect(buffer.append('stderr', 'unrelated stderr\n')).toEqual(['unrelated stderr'])
    expect(buffer.append('stdout', 'end\n')).toEqual(['partial stdout end'])
  })

  it('caps the carried tail while returning that chunk\u2019s complete lines in full', () => {
    const buffer = createStreamLineBuffer(8)
    const long = 'A'.repeat(20)
    expect(buffer.append('stdout', `${long}\nkeep\n${'B'.repeat(20)}`)).toEqual([long, 'keep'])
    expect(buffer.takePending('stdout')).toBe('B'.repeat(8))
  })

  it('keeps the END of an oversized tail, so a line completing later is truncated', () => {
    const buffer = createStreamLineBuffer(4)
    buffer.append('stdout', 'abcdefgh')
    expect(buffer.append('stdout', 'ij\n')).toEqual(['efghij'])
  })

  it('takePending returns the tail and clears it in the same step', () => {
    const buffer = createStreamLineBuffer()
    buffer.append('stdout', 'trailing without newline')
    expect(buffer.takePending('stdout')).toBe('trailing without newline')
    expect(buffer.takePending('stdout')).toBe('')
  })

  it('reset drops both streams\u2019 tails', () => {
    const buffer = createStreamLineBuffer()
    buffer.append('stdout', 'stdout tail')
    buffer.append('stderr', 'stderr tail')
    buffer.reset()
    expect(buffer.takePending('stdout')).toBe('')
    expect(buffer.takePending('stderr')).toBe('')
    expect(buffer.append('stdout', 'fresh\n')).toEqual(['fresh'])
  })
})
