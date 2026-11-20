import { describe, expect, it } from 'vitest'
import { progressActionName, progressTitle } from './progressTitle'

describe('progressTitle', () => {
  it('joins the action and the build without an em dash', () => {
    expect(progressTitle('Installing', 'ComfyUI')).toBe('Installing · ComfyUI')
    expect(progressTitle('Installing', 'ComfyUI')).not.toContain('—')
  })

  it('reads the action back from a title', () => {
    expect(progressActionName(progressTitle('Updating ComfyUI', 'My build'))).toBe(
      'Updating ComfyUI'
    )
    expect(progressActionName('Working')).toBe('Working')
  })
})
