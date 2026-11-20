import { describe, expect, it } from 'vitest'
import { i18n } from '../i18n'
import { revealInFolderKey, revealInFolderLabel } from './usePlatform'

describe('revealInFolderLabel', () => {
  it.each([
    ['darwin', 'Show in Finder'],
    ['win32', 'Show in Explorer'],
    ['linux', 'Show in folder'],
    [undefined, 'Show in folder']
  ])('names the file manager in sentence case on %s', (platform, label) => {
    expect(revealInFolderLabel(platform)).toBe(label)
  })

  it.each(['darwin', 'win32', 'linux', undefined])(
    'matches the locale label on %s, so every folder action has one name',
    (platform) => {
      expect(i18n.global.t(revealInFolderKey(platform))).toBe(revealInFolderLabel(platform))
    }
  )
})
