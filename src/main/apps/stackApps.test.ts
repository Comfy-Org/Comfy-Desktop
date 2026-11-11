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

  it('puts the app on top when the panel is not in the window', () => {
    const content = fakeContent(['comfy', 'titlebar'])
    stackApps(content, 'apps', 'panel', true)
    expect(content.children).toEqual(['comfy', 'titlebar', 'apps'])
  })
})
