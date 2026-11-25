import { describe, expect, it } from 'vitest'
import { i18n } from '../i18n'
import { revealInFolderKey } from './usePlatform'

describe('revealInFolderKey', () => {
  it.each([
    ['darwin', 'Show in Finder'],
    ['win32', 'Show in Explorer'],
    ['linux', 'Show in folder'],
    [undefined, 'Show in folder']
  ])('names the file manager in sentence case on %s', (platform, label) => {
    expect(i18n.global.t(revealInFolderKey(platform))).toBe(label)
  })
})
