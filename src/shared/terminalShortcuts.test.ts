import { describe, it, expect } from 'vitest'
import {
  decideTerminalKeyAction,
  type TerminalKeyEventLike,
  type TerminalPlatform,
} from './terminalShortcuts'

function ev(overrides: Partial<TerminalKeyEventLike>): TerminalKeyEventLike {
  return {
    type: 'keydown',
    key: 'a',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  }
}

const decide = (
  e: Partial<TerminalKeyEventLike>,
  platform: TerminalPlatform,
  hasSelection: boolean,
): ReturnType<typeof decideTerminalKeyAction> =>
  decideTerminalKeyAction(ev(e), platform, hasSelection)

describe('decideTerminalKeyAction', () => {
  it('ignores non-keydown events', () => {
    expect(decide({ type: 'keyup', key: 'c', metaKey: true }, 'mac', true)).toBe('passthrough')
  })

  describe('macOS', () => {
    it('Cmd+C copies when there is a selection', () => {
      expect(decide({ key: 'c', metaKey: true }, 'mac', true)).toBe('copy')
    })
    it('Cmd+C is swallowed (never SIGINT) when there is no selection', () => {
      expect(decide({ key: 'c', metaKey: true }, 'mac', false)).toBe('swallow')
    })
    it('Cmd+V pastes', () => {
      expect(decide({ key: 'v', metaKey: true }, 'mac', false)).toBe('paste')
    })
    it('Ctrl+C always passes through as SIGINT, even with a selection', () => {
      expect(decide({ key: 'c', ctrlKey: true }, 'mac', true)).toBe('passthrough')
    })
    it('Ctrl+Shift+C is not a mac copy shortcut', () => {
      expect(decide({ key: 'c', ctrlKey: true, shiftKey: true }, 'mac', true)).toBe('passthrough')
    })
  })

  describe('Windows', () => {
    it('Ctrl+Shift+C always copies when selected', () => {
      expect(decide({ key: 'c', ctrlKey: true, shiftKey: true }, 'windows', true)).toBe('copy')
    })
    it('Ctrl+Shift+C is swallowed (no stray ^C) when nothing is selected', () => {
      expect(decide({ key: 'c', ctrlKey: true, shiftKey: true }, 'windows', false)).toBe('swallow')
    })
    it('Ctrl+Shift+V pastes', () => {
      expect(decide({ key: 'v', ctrlKey: true, shiftKey: true }, 'windows', false)).toBe('paste')
    })
    it('Ctrl+C copies when text is selected', () => {
      expect(decide({ key: 'c', ctrlKey: true }, 'windows', true)).toBe('copy')
    })
    it('Ctrl+C passes through as SIGINT when nothing is selected', () => {
      expect(decide({ key: 'c', ctrlKey: true }, 'windows', false)).toBe('passthrough')
    })
    it('Ctrl+V pastes', () => {
      expect(decide({ key: 'v', ctrlKey: true }, 'windows', false)).toBe('paste')
    })
  })

  describe('Linux', () => {
    it('Ctrl+Shift+C copies when selected', () => {
      expect(decide({ key: 'c', ctrlKey: true, shiftKey: true }, 'linux', true)).toBe('copy')
    })
    it('Ctrl+Shift+V pastes', () => {
      expect(decide({ key: 'v', ctrlKey: true, shiftKey: true }, 'linux', false)).toBe('paste')
    })
    it('bare Ctrl+C always passes through as SIGINT (even with selection)', () => {
      expect(decide({ key: 'c', ctrlKey: true }, 'linux', true)).toBe('passthrough')
    })
    it('bare Ctrl+V passes through (no paste on bare Ctrl+V)', () => {
      expect(decide({ key: 'v', ctrlKey: true }, 'linux', false)).toBe('passthrough')
    })
  })

  it('leaves ordinary typing untouched', () => {
    expect(decide({ key: 'a' }, 'windows', true)).toBe('passthrough')
    expect(decide({ key: 'a' }, 'mac', true)).toBe('passthrough')
  })
})
