import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, shallowRef, type ShallowRef } from 'vue'
import { mount } from '@vue/test-utils'
import { useTitleBarMenus } from './useTitleBarMenus'

vi.mock('vue-i18n', async (importOriginal) =>
  (await import('../lib/vueI18nWithAppMessages')).vueI18nWithAppMessages(importOriginal)
)

type TitleMenuKind = 'menu' | 'downloads' | 'instance-picker'

interface Bridge {
  openFileMenu: ReturnType<typeof vi.fn>
  dismissFileMenu: ReturnType<typeof vi.fn>
  clickDownloadsTray: ReturnType<typeof vi.fn>
  onMenuOpened: (cb: (info: { menu: TitleMenuKind }) => void) => () => void
  onMenuClosed: (cb: (info: { menu: TitleMenuKind }) => void) => () => void
  onDownloadsChanged: (cb: (s: unknown) => void) => () => void
}

function setup() {
  const opened: ((info: { menu: TitleMenuKind }) => void)[] = []
  const closed: ((info: { menu: TitleMenuKind }) => void)[] = []
  const bridge: Bridge = {
    openFileMenu: vi.fn(),
    openWhatsNewMenu: vi.fn(),
    dismissFileMenu: vi.fn(),
    clickDownloadsTray: vi.fn(),
    onMenuOpened: (cb) => {
      opened.push(cb)
      return () => {}
    },
    onMenuClosed: (cb) => {
      closed.push(cb)
      return () => {}
    },
    onDownloadsChanged: () => () => {}
  }
  const nullRef = shallowRef<HTMLElement | null>(null) as Readonly<ShallowRef<HTMLElement | null>>
  let api!: ReturnType<typeof useTitleBarMenus>
  const Host = defineComponent({
    setup() {
      api = useTitleBarMenus({
        bridge: bridge as never,
        hideTip: () => {},
        fileBtnRef: nullRef,
        downloadsBtnRef: nullRef,
        whatsNewBtnRef: nullRef
      })
      return () => h('div')
    }
  })
  mount(Host)
  return {
    api,
    bridge,
    openMenu: (menu: TitleMenuKind) => opened.forEach((cb) => cb({ menu })),
    closeMenu: (menu: TitleMenuKind) => closed.forEach((cb) => cb({ menu }))
  }
}

describe('useTitleBarMenus — handleFileMenu toggle gate', () => {
  it('opens the file menu when the instance picker is the open popup (does not toggle-close)', () => {
    const { api, bridge, openMenu } = setup()
    openMenu('instance-picker')
    api.handleFileMenu()
    expect(bridge.openFileMenu).toHaveBeenCalledTimes(1)
    expect(bridge.dismissFileMenu).not.toHaveBeenCalled()
  })

  it('opens the file menu when the downloads tray is the open popup', () => {
    const { api, bridge, openMenu } = setup()
    openMenu('downloads')
    api.handleFileMenu()
    expect(bridge.openFileMenu).toHaveBeenCalledTimes(1)
    expect(bridge.dismissFileMenu).not.toHaveBeenCalled()
  })

  it('toggle-closes only when the file menu itself is open', () => {
    const { api, bridge, openMenu } = setup()
    openMenu('menu')
    api.handleFileMenu()
    expect(bridge.dismissFileMenu).toHaveBeenCalledTimes(1)
    expect(bridge.openFileMenu).not.toHaveBeenCalled()
  })

  it('a picker close (menu-closed: instance-picker) does not arm the file-menu reopen guard', () => {
    const { api, bridge, openMenu, closeMenu } = setup()
    openMenu('instance-picker')
    closeMenu('instance-picker')
    api.handleFileMenu()
    expect(bridge.openFileMenu).toHaveBeenCalledTimes(1)
  })
})

describe("useTitleBarMenus — the bell opens the What's new menu", () => {
  it("opens the What's new menu from the bell", () => {
    const { api, bridge } = setup()
    api.handleWhatsNewMenu()
    expect(bridge.openWhatsNewMenu).toHaveBeenCalledTimes(1)
    expect(bridge.openFileMenu).not.toHaveBeenCalled()
  })

  it("closes the What's new menu when the bell is clicked again", () => {
    const { api, bridge, openMenu } = setup()
    api.handleWhatsNewMenu()
    openMenu('menu')
    api.handleWhatsNewMenu()
    expect(bridge.dismissFileMenu).toHaveBeenCalledTimes(1)
  })

  it("opens the file menu instead of closing when the What's new menu is open", () => {
    const { api, bridge, openMenu } = setup()
    api.handleWhatsNewMenu()
    openMenu('menu')
    api.handleFileMenu()
    expect(bridge.openFileMenu).toHaveBeenCalledTimes(1)
    expect(bridge.dismissFileMenu).not.toHaveBeenCalled()
  })
})
