import { describe, expect, it, vi } from 'vitest'

import {
  BACKDROP_BLUR_CSS,
  blurContentsBehindBackdrop,
  staysSharpBehindBackdrop,
  type BlurrableContents
} from './backdropBlur'

function fakeContents(url: string, destroyed = false) {
  const contents = {
    isDestroyed: vi.fn(() => destroyed),
    getURL: () => url,
    insertCSS: vi.fn(async (_css: string) => `key-${url}`),
    removeInsertedCSS: vi.fn(async (_key: string) => {})
  }
  return contents satisfies BlurrableContents
}

describe('blur behind the popup backdrop', () => {
  it('blurs the panel and a ComfyUI page, and leaves the title bar, popups and backdrop sharp', async () => {
    const panel = fakeContents('file:///app/panel.html')
    const comfy = fakeContents('http://127.0.0.1:8188/')
    const titleBar = fakeContents('file:///app/comfyTitleBar.html')
    const popup = fakeContents('file:///app/comfyTitlePopup.html')
    const backdrop = fakeContents('data:text/html;charset=utf-8,scrim')

    blurContentsBehindBackdrop([panel, comfy, titleBar, popup, backdrop])
    await Promise.resolve()

    expect(panel.insertCSS).toHaveBeenCalledWith(BACKDROP_BLUR_CSS)
    expect(comfy.insertCSS).toHaveBeenCalledWith(BACKDROP_BLUR_CSS)
    expect(titleBar.insertCSS).not.toHaveBeenCalled()
    expect(popup.insertCSS).not.toHaveBeenCalled()
    expect(backdrop.insertCSS).not.toHaveBeenCalled()
  })

  it('removes the blur it added when the backdrop hides', async () => {
    const panel = fakeContents('file:///app/panel.html')

    const unblur = blurContentsBehindBackdrop([panel])
    unblur()
    await vi.waitFor(() =>
      expect(panel.removeInsertedCSS).toHaveBeenCalledWith('key-file:///app/panel.html')
    )
  })

  it('skips a view that is already gone, before and after', async () => {
    const gone = fakeContents('file:///app/panel.html', true)

    const unblur = blurContentsBehindBackdrop([gone])
    unblur()
    await Promise.resolve()

    expect(gone.insertCSS).not.toHaveBeenCalled()
    expect(gone.removeInsertedCSS).not.toHaveBeenCalled()
  })

  it('keeps the window chrome sharp by URL', () => {
    expect(staysSharpBehindBackdrop('file:///app/comfyTitleBar.html')).toBe(true)
    expect(staysSharpBehindBackdrop('file:///app/panel.html')).toBe(false)
  })
})
