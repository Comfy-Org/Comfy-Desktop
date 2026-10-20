import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { INFO_CLOSE_DELAY_MS, INFO_OPEN_DELAY_MS, useBuildMenus } from './useBuildMenus'

/** Mount the composable and play main's side: confirm opens (echoing the menu
 *  last asked for, unless told otherwise) and closes, and report the pointer
 *  entering or leaving the popup. */
function setup(otherPopupOpen = false) {
  const opened: ((info: { menu: string; menuId?: string }) => void)[] = []
  const closed: ((info: { menu: string }) => void)[] = []
  const hover: ((inside: boolean) => void)[] = []
  const bridge = {
    openBuildMenu: vi.fn(),
    dismissFileMenu: vi.fn(),
    onMenuOpened: (cb: (info: { menu: string; menuId?: string }) => void) => (
      opened.push(cb),
      () => {}
    ),
    onMenuClosed: (cb: (info: { menu: string }) => void) => (closed.push(cb), () => {}),
    onPopupHover: (cb: (inside: boolean) => void) => (hover.push(cb), () => {})
  }
  let api!: ReturnType<typeof useBuildMenus>
  mount(
    defineComponent({
      setup() {
        api = useBuildMenus(bridge, () => otherPopupOpen)
        return () => h('div')
      }
    })
  )
  const el = document.createElement('button')
  return {
    api,
    bridge,
    el,
    mainOpens: (menuId: string | undefined = bridge.openBuildMenu.mock.lastCall?.[0]) =>
      opened.forEach((cb) => cb({ menu: 'menu', menuId })),
    mainCloses: () => closed.forEach((cb) => cb({ menu: 'menu' })),
    pointerInPopup: (inside: boolean) => hover.forEach((cb) => cb(inside))
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useBuildMenus: the info card', () => {
  it('opens after the pointer rests on the build name', () => {
    const { api, bridge, el } = setup()
    api.onBuildEnter(el)
    vi.advanceTimersByTime(INFO_OPEN_DELAY_MS - 1)
    expect(bridge.openBuildMenu).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(bridge.openBuildMenu).toHaveBeenCalledExactlyOnceWith('install-info', {
      x: 0,
      y: 0
    })
  })

  it('does not open when the pointer passes over the name', () => {
    const { api, bridge, el } = setup()
    api.onBuildEnter(el)
    api.onBuildLeave()
    vi.advanceTimersByTime(INFO_OPEN_DELAY_MS)
    expect(bridge.openBuildMenu).not.toHaveBeenCalled()
  })

  it('opens at once on a click', () => {
    const { api, bridge, el } = setup()
    api.onBuildClick(el)
    expect(bridge.openBuildMenu).toHaveBeenCalledWith('install-info', expect.anything())
  })

  it('stays open while the pointer moves from the name into the card', () => {
    const { api, bridge, el, mainOpens, pointerInPopup } = setup()
    api.onBuildClick(el)
    mainOpens()
    expect(api.openMenu.value).toBe('install-info')
    api.onBuildLeave()
    pointerInPopup(true)
    vi.advanceTimersByTime(INFO_CLOSE_DELAY_MS * 2)
    expect(bridge.dismissFileMenu).not.toHaveBeenCalled()
  })

  it('closes once the pointer has left both the name and the card', () => {
    const { api, bridge, el, mainOpens, pointerInPopup } = setup()
    api.onBuildEnter(el)
    vi.advanceTimersByTime(INFO_OPEN_DELAY_MS)
    mainOpens()
    api.onBuildLeave()
    pointerInPopup(true)
    pointerInPopup(false)
    vi.advanceTimersByTime(INFO_CLOSE_DELAY_MS - 1)
    expect(bridge.dismissFileMenu).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(bridge.dismissFileMenu).toHaveBeenCalledOnce()
  })

  it('does not open over another title-bar popup', () => {
    const { api, bridge, el } = setup(true)
    api.onBuildEnter(el)
    vi.advanceTimersByTime(INFO_OPEN_DELAY_MS)
    expect(bridge.openBuildMenu).not.toHaveBeenCalled()
  })

  it('stays open when a click opened it, until it is dismissed', () => {
    const { api, bridge, el, mainOpens, pointerInPopup } = setup()
    api.onBuildClick(el)
    mainOpens()
    api.onBuildLeave()
    pointerInPopup(false)
    vi.advanceTimersByTime(INFO_CLOSE_DELAY_MS * 2)
    expect(bridge.dismissFileMenu).not.toHaveBeenCalled()
  })

  it('does not reopen on the click that dismissed it', () => {
    const { api, bridge, el, mainOpens, mainCloses } = setup()
    api.onBuildClick(el)
    mainOpens()
    mainCloses()
    api.onBuildClick(el)
    expect(bridge.openBuildMenu).toHaveBeenCalledOnce()
  })

  it('closes when it opens after the pointer already left the name', () => {
    const { api, bridge, el, mainOpens } = setup()
    api.onBuildEnter(el)
    vi.advanceTimersByTime(INFO_OPEN_DELAY_MS)
    api.onBuildLeave()
    mainOpens()
    vi.advanceTimersByTime(INFO_CLOSE_DELAY_MS)
    expect(bridge.dismissFileMenu).toHaveBeenCalledOnce()
  })
})

describe('useBuildMenus: the switcher', () => {
  it('opens on the chevron and closes on a second click', () => {
    const { api, bridge, el, mainOpens } = setup()
    api.toggleSwitcher(el)
    expect(bridge.openBuildMenu).toHaveBeenCalledWith('install-switcher', expect.anything())
    mainOpens()
    expect(api.openMenu.value).toBe('install-switcher')
    api.toggleSwitcher(el)
    expect(bridge.dismissFileMenu).toHaveBeenCalledOnce()
  })

  it('does not reopen on the click that dismissed it', () => {
    const { api, bridge, el, mainOpens, mainCloses } = setup()
    api.toggleSwitcher(el)
    mainOpens()
    mainCloses()
    expect(api.openMenu.value).toBeNull()
    api.toggleSwitcher(el)
    expect(bridge.openBuildMenu).toHaveBeenCalledOnce()
  })

  it('is not taken for the file menu, which main also reports as a menu', () => {
    const { api, mainOpens } = setup()
    mainOpens('file')
    expect(api.openMenu.value).toBeNull()
  })

  it('follows the menu main says opened when two are asked for in a row', () => {
    const { api, el, mainOpens } = setup()
    api.toggleSwitcher(el)
    api.onBuildClick(el)
    mainOpens('install-switcher')
    expect(api.openMenu.value).toBe('install-switcher')
    mainOpens('install-info')
    expect(api.openMenu.value).toBe('install-info')
  })

  it('keeps the info card from opening over it', () => {
    const { api, bridge, el, mainOpens } = setup()
    api.toggleSwitcher(el)
    mainOpens()
    api.onBuildEnter(el)
    vi.advanceTimersByTime(INFO_OPEN_DELAY_MS)
    expect(bridge.openBuildMenu).toHaveBeenCalledOnce()
  })
})
