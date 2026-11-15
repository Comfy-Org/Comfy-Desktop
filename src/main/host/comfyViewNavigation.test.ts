import { EventEmitter } from 'events'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ tryOpenExternalUrl: vi.fn(async () => true) }))

vi.mock('../lib/openExternal', () => ({ tryOpenExternalUrl: mocks.tryOpenExternalUrl }))

import {
  comfyViewShowsItsInstall,
  keepComfyViewOnInstallSite,
  openOutsideComfyView
} from './comfyViewNavigation'
import type { ComfyWindowEntry } from './registry'

const INSTALL_URL = 'http://127.0.0.1:8188'
const ELSEWHERE = 'https://elsewhere.example.test/docs'

class FakeView extends EventEmitter {
  url = `${INSTALL_URL}/`
  readonly session = { downloadURL: vi.fn() }
  getURL(): string {
    return this.url
  }
  get contents(): WebContents {
    return this as unknown as WebContents
  }
  navigateTo(url: string): { stopped: boolean } {
    const event = { defaultPrevented: false, preventDefault: vi.fn() }
    event.preventDefault.mockImplementation(() => {
      event.defaultPrevented = true
    })
    this.emit('will-navigate', event, url)
    return { stopped: event.defaultPrevented }
  }
}

function hostOf(
  comfyUrl = INSTALL_URL,
  installationId: string | null = 'inst-1'
): ComfyWindowEntry {
  return { installationId, comfyUrl } as ComfyWindowEntry
}

function pinnedView(hostEntry: () => ComfyWindowEntry | undefined = hostOf): FakeView {
  const view = new FakeView()
  keepComfyViewOnInstallSite(view.contents, hostEntry)
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("a ComfyUI view on its install's site", () => {
  it('opens a link to another site outside the app and stays where it is', () => {
    const view = pinnedView()

    expect(view.navigateTo(ELSEWHERE)).toEqual({ stopped: true })
    expect(mocks.tryOpenExternalUrl).toHaveBeenCalledExactlyOnceWith(ELSEWHERE)
    expect(view.session.downloadURL).not.toHaveBeenCalled()
  })

  it("moves freely within the install's own site", () => {
    const view = pinnedView()

    expect(view.navigateTo(`${INSTALL_URL}/api/view?filename=a.png`)).toEqual({ stopped: false })
    expect(mocks.tryOpenExternalUrl).not.toHaveBeenCalled()
  })

  it('hands a model or archive link to the download manager, not the browser', () => {
    const view = pinnedView()
    const model = 'https://models.example.test/flux/model.safetensors'

    expect(view.navigateTo(model)).toEqual({ stopped: true })
    expect(view.session.downloadURL).toHaveBeenCalledExactlyOnceWith(model)
    expect(mocks.tryOpenExternalUrl).not.toHaveBeenCalled()
  })

  it.each(['smb://files.example.test/share', 'file:///etc/hosts', 'about:blank'])(
    'does not follow %s, and leaves it to the link helper to refuse',
    (url) => {
      const view = pinnedView()

      expect(view.navigateTo(url)).toEqual({ stopped: true })
      expect(mocks.tryOpenExternalUrl).toHaveBeenCalledExactlyOnceWith(url)
    }
  )

  it('treats the https address of a plain-http install as the same site', () => {
    const view = pinnedView(() => hostOf('http://comfy.example.test'))
    view.url = 'http://comfy.example.test/'

    expect(view.navigateTo('https://comfy.example.test/')).toEqual({ stopped: false })
  })
})

describe('a ComfyUI view that its server sent to another site', () => {
  it('lets that page finish and come back, as a sign-in page must', () => {
    const view = pinnedView()
    view.url = 'https://login.example.test/start'

    expect(view.navigateTo('https://login.example.test/second-step')).toEqual({ stopped: false })
    expect(view.navigateTo('https://identity.example.test/verify')).toEqual({ stopped: false })
    expect(view.navigateTo(`${INSTALL_URL}/`)).toEqual({ stopped: false })
    expect(mocks.tryOpenExternalUrl).not.toHaveBeenCalled()
  })

  it('is no longer counted as showing its install', () => {
    const view = pinnedView()
    expect(comfyViewShowsItsInstall(view.contents, () => hostOf())).toBe(true)

    view.url = ELSEWHERE
    expect(comfyViewShowsItsInstall(view.contents, () => hostOf())).toBe(false)
  })
})

describe('a ComfyUI view with nothing to protect', () => {
  it.each([
    ['its window shows no install', hostOf('', null)],
    ['its window is gone', undefined]
  ])('is left alone when %s', (_why, host) => {
    const view = pinnedView(() => host)

    expect(view.navigateTo(ELSEWHERE)).toEqual({ stopped: false })
    expect(comfyViewShowsItsInstall(view.contents, () => host)).toBe(false)
  })
})

describe('sending a link out of the view', () => {
  it('downloads what looks like a file and opens everything else outside', () => {
    const view = new FakeView()

    openOutsideComfyView(view.contents, 'https://example.test/archive.zip')
    openOutsideComfyView(view.contents, 'https://example.test/guide')

    expect(view.session.downloadURL).toHaveBeenCalledExactlyOnceWith(
      'https://example.test/archive.zip'
    )
    expect(mocks.tryOpenExternalUrl).toHaveBeenCalledExactlyOnceWith('https://example.test/guide')
  })
})
