// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { stackApps } from './stackApps'

function fakeContent(children: string[]) {
  return {
    children,
    addChildView(view: string, index = children.length) {
      const at = children.indexOf(view)
      if (at !== -1) children.splice(at, 1)
      children.splice(Math.min(index, children.length), 0, view)
    }
  }
}

describe('stackApps', () => {
  it('adds a parked app just below the panel', () => {
    const content = fakeContent(['comfy', 'panel', 'titlebar'])
    stackApps(content, 'apps', 'panel', true)
    expect(content.children).toEqual(['comfy', 'apps', 'panel', 'titlebar'])
  })

  it('moves a shown app back below the panel when it is parked again', () => {
    const content = fakeContent(['comfy', 'panel', 'titlebar', 'apps'])
    stackApps(content, 'apps', 'panel', true)
    expect(content.children).toEqual(['comfy', 'apps', 'panel', 'titlebar'])
  })

  it('keeps a parked app below the panel when it is parked again', () => {
    const content = fakeContent(['comfy', 'apps', 'panel', 'titlebar'])
    stackApps(content, 'apps', 'panel', true)
    expect(content.children).toEqual(['comfy', 'apps', 'panel', 'titlebar'])
  })

  it('brings the app to the top when it is no longer parked', () => {
    const content = fakeContent(['comfy', 'apps', 'panel', 'titlebar'])
    stackApps(content, 'apps', 'panel', false)
    expect(content.children).toEqual(['comfy', 'panel', 'titlebar', 'apps'])
  })

  it('leaves a parked app out of the window when the panel is not in it', () => {
    const content = fakeContent(['comfy', 'titlebar'])
    expect(stackApps(content, 'apps', 'panel', true)).toBe(false)
    expect(content.children).toEqual(['comfy', 'titlebar'])
  })

  it('leaves a shown app where it is when the panel is gone and it is parked again', () => {
    const content = fakeContent(['comfy', 'titlebar', 'apps'])
    expect(stackApps(content, 'apps', 'panel', true)).toBe(false)
    expect(content.children).toEqual(['comfy', 'titlebar', 'apps'])
  })

  it('says the app is stacked when the panel is there', () => {
    expect(stackApps(fakeContent(['comfy', 'panel']), 'apps', 'panel', true)).toBe(true)
    expect(stackApps(fakeContent(['comfy']), 'apps', 'panel', false)).toBe(true)
  })
})
