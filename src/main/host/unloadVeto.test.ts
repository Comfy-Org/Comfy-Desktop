import { describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'

import { leavesWithoutVeto, takeUnloadVeto } from './unloadVeto'

const contents = {} as WebContents

describe('unloadVeto', () => {
  it('leaves when the page lets it go', async () => {
    await expect(leavesWithoutVeto(contents, async () => {})).resolves.toBe(true)
  })

  it('reports a veto the page raises while leaving, even if the navigation never settles', async () => {
    const leaving = leavesWithoutVeto(contents, () => {
      expect(takeUnloadVeto(contents)).toBe(true)
      return new Promise(() => {})
    })

    await expect(leaving).resolves.toBe(false)
  })

  it('leaves a veto raised outside an attempt to Desktop, which overrides it', async () => {
    await leavesWithoutVeto(contents, async () => {})

    expect(takeUnloadVeto(contents)).toBe(false)
  })

  it('counts a navigation that fails as having left', async () => {
    await expect(
      leavesWithoutVeto(contents, () => Promise.reject(new Error('ERR_ABORTED')))
    ).resolves.toBe(true)
  })
})
