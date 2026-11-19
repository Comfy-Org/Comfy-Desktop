import { describe, expect, it } from 'vitest'
import { revealInFolderLabel } from './usePlatform'

describe('revealInFolderLabel', () => {
  it.each([
    ['darwin', 'Show in Finder'],
    ['win32', 'Show in Explorer'],
    ['linux', 'Show in folder'],
    [undefined, 'Open folder']
  ])('names the file manager in sentence case on %s', (platform, label) => {
    expect(revealInFolderLabel(platform)).toBe(label)
  })
})
