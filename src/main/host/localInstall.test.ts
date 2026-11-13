import { describe, expect, it } from 'vitest'

import { isLocalInstall } from './localInstall'
import type { ComfyWindowEntry } from './registry'

function entry(installationId: string | null, sourceCategory: string | null): ComfyWindowEntry {
  return { installationId, sourceCategory } as ComfyWindowEntry
}

describe('isLocalInstall', () => {
  it('accepts an attached install from a local source', () => {
    expect(isLocalInstall(entry('inst-1', 'local'))).toBe(true)
  })

  it.each([
    ['a Remote Connection', entry('inst-1', 'remote')],
    ['a Cloud install', entry('inst-1', 'cloud')],
    ['an install of unknown source', entry('inst-1', null)],
    ['a preview host carrying a local category', entry(null, 'local')],
    ['an empty installation id', entry('', 'local')],
    ['no entry', null],
    ['an undefined entry', undefined]
  ])('refuses %s', (_name, value) => {
    expect(isLocalInstall(value)).toBe(false)
  })
})
