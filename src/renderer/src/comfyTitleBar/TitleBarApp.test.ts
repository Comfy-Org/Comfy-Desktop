import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

interface MockDownloadsTrayEntry {
  url: string
  filename: string
  directory?: string
  progress: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'
  error?: string
}
interface MockDownloadsTrayState {
  active: MockDownloadsTrayEntry[]
  recent: MockDownloadsTrayEntry[]
}

interface MockBridgeState {
  panelChangedCallbacks: ((panel: string) => void)[]
  titleChangedCallbacks: ((title: string) => void)[]
  sourceCategoryChangedCallbacks: ((category: string | null) => void)[]
  zoomChangedCallbacks: ((level: number) => void)[]
  themeChangedCallbacks: ((theme: { bg: string; text: string }) => void)[]
  fullscreenChangedCallbacks: ((fullscreen: boolean) => void)[]
  menuOpenedCallbacks: ((info: { menu: 'menu' }) => void)[]
  menuClosedCallbacks: ((info: { menu: 'menu' }) => void)[]
  firstUseModeChangedCallbacks: ((
    mode: 'none' | 'consent-lockdown' | 'post-consent' | 'loading-lockdown'
  ) => void)[]
  previewModeChangedCallbacks: ((preview: boolean) => void)[]
  installationIdChangedCallbacks: ((installationId: string | null) => void)[]
  appUpdateStateCallbacks: ((state: {
    kind: 'available' | 'ready' | null
    version: string | null
    autoUpdate: boolean
  }) => void)[]
  installUpdateAvailableCallbacks: ((state: {
    available: boolean
    version: string | null
  }) => void)[]
  downloadsChangedCallbacks: ((state: MockDownloadsTrayState) => void)[]
  setPanelCalls: string[]
  newWindowCalls: number
  fileMenuAnchors: { x: number; y: number }[]
  whatsNewMenuAnchors: { x: number; y: number }[]
  fileMenuDismisses: number
  appUpdatePillClicks: number
  installUpdatePillClicks: number
  downloadsTrayClicks: number
  feedbackClicks: number
  refreshInstanceClicks: number
  homeClicks: number
  resetZoomClicks: number
  showTooltipCalls: { text: string; leftX: number; rightX: number; bottomY: number }[]
  hideTooltipCalls: number
  showCoachmarkCalls: {
    kind?: string
    title: string
    body: string
    dismissLabel: string
    actionLabel?: string
    leftX: number
    rightX: number
    bottomY: number
  }[]
  hideCoachmarkCalls: number
  coachmarkDismissedCallbacks: ((payload: { kind: string }) => void)[]
  coachmarkActionCallbacks: ((payload: { kind: string }) => void)[]
  coachmarkAutoHiddenCallbacks: ((payload: { kind: string }) => void)[]
  coachmarkSettledCallbacks: ((payload: { kind: string }) => void)[]
  coachmarkDisplacedCallbacks: ((payload: { kind: string }) => void)[]
  readyCalls: number
}

function installMockBridge(
  opts: { isMac?: boolean; isLinux?: boolean; installationId?: string | null } = {}
): MockBridgeState {
  const state: MockBridgeState = {
    panelChangedCallbacks: [],
    titleChangedCallbacks: [],
    sourceCategoryChangedCallbacks: [],
    zoomChangedCallbacks: [],
    themeChangedCallbacks: [],
    fullscreenChangedCallbacks: [],
    menuOpenedCallbacks: [],
    menuClosedCallbacks: [],
    firstUseModeChangedCallbacks: [],
    previewModeChangedCallbacks: [],
    installationIdChangedCallbacks: [],
    appUpdateStateCallbacks: [],
    installUpdateAvailableCallbacks: [],
    downloadsChangedCallbacks: [],
    setPanelCalls: [],
    newWindowCalls: 0,
    fileMenuAnchors: [],
    whatsNewMenuAnchors: [],
    fileMenuDismisses: 0,
    appUpdatePillClicks: 0,
    installUpdatePillClicks: 0,
    downloadsTrayClicks: 0,
    feedbackClicks: 0,
    refreshInstanceClicks: 0,
    homeClicks: 0,
    resetZoomClicks: 0,
    showTooltipCalls: [],
    hideTooltipCalls: 0,
    showCoachmarkCalls: [],
    hideCoachmarkCalls: 0,
    coachmarkDismissedCallbacks: [],
    coachmarkActionCallbacks: [],
    coachmarkAutoHiddenCallbacks: [],
    coachmarkSettledCallbacks: [],
    coachmarkDisplacedCallbacks: [],
    readyCalls: 0
  }
  const installationId = opts.installationId === undefined ? 'test-id' : opts.installationId
  const bridge = {
    getInstallationId: () => installationId,
    isMac: () => !!opts.isMac,
    isLinux: () => !!opts.isLinux,
    setPanel: (panel: string) => state.setPanelCalls.push(panel),
    openNewWindow: () => {
      state.newWindowCalls += 1
    },
    openFileMenu: (anchor: { x: number; y: number }) => {
      state.fileMenuAnchors.push(anchor)
    },
    openWhatsNewMenu: (anchor: { x: number; y: number }) => {
      state.whatsNewMenuAnchors.push(anchor)
    },
    dismissFileMenu: () => {
      state.fileMenuDismisses += 1
    },
    onPanelChanged: (cb: (panel: string) => void) => {
      state.panelChangedCallbacks.push(cb)
      return () => {}
    },
    onTitleChanged: (cb: (title: string) => void) => {
      state.titleChangedCallbacks.push(cb)
      return () => {}
    },
    onSourceCategoryChanged: (cb: (category: string | null) => void) => {
      state.sourceCategoryChangedCallbacks.push(cb)
      return () => {}
    },
    onZoomChanged: (cb: (level: number) => void) => {
      state.zoomChangedCallbacks.push(cb)
      return () => {}
    },
    onThemeChanged: (cb: (theme: { bg: string; text: string }) => void) => {
      state.themeChangedCallbacks.push(cb)
      return () => {}
    },
    onFullscreenChanged: (cb: (fullscreen: boolean) => void) => {
      state.fullscreenChangedCallbacks.push(cb)
      return () => {}
    },
    onMenuOpened: (cb: (info: { menu: 'menu' }) => void) => {
      state.menuOpenedCallbacks.push(cb)
      return () => {}
    },
    onMenuClosed: (cb: (info: { menu: 'menu' }) => void) => {
      state.menuClosedCallbacks.push(cb)
      return () => {}
    },
    onFirstUseModeChanged: (
      cb: (mode: 'none' | 'consent-lockdown' | 'post-consent' | 'loading-lockdown') => void
    ) => {
      state.firstUseModeChangedCallbacks.push(cb)
      return () => {}
    },
    onPreviewModeChanged: (cb: (preview: boolean) => void) => {
      state.previewModeChangedCallbacks.push(cb)
      return () => {}
    },
    onInstallationIdChanged: (cb: (installationId: string | null) => void) => {
      state.installationIdChangedCallbacks.push(cb)
      return () => {}
    },
    onAppUpdateStateChanged: (
      cb: (next: {
        kind: 'available' | 'ready' | null
        version: string | null
        autoUpdate: boolean
      }) => void
    ) => {
      state.appUpdateStateCallbacks.push(cb)
      return () => {}
    },
    onInstallUpdateAvailable: (
      cb: (next: { available: boolean; version: string | null }) => void
    ) => {
      state.installUpdateAvailableCallbacks.push(cb)
      return () => {}
    },
    clickAppUpdatePill: () => {
      state.appUpdatePillClicks += 1
    },
    clickInstallUpdatePill: () => {
      state.installUpdatePillClicks += 1
    },
    onDownloadsChanged: (cb: (next: MockDownloadsTrayState) => void) => {
      state.downloadsChangedCallbacks.push(cb)
      return () => {}
    },
    clickDownloadsTray: () => {
      state.downloadsTrayClicks += 1
    },
    clickFeedback: () => {
      state.feedbackClicks += 1
    },
    clickRefreshInstance: () => {
      state.refreshInstanceClicks += 1
    },
    clickHome: () => {
      state.homeClicks += 1
    },
    resetZoom: () => {
      state.resetZoomClicks += 1
    },
    showTooltip: (payload: { text: string; leftX: number; rightX: number; bottomY: number }) => {
      state.showTooltipCalls.push(payload)
    },
    hideTooltip: () => {
      state.hideTooltipCalls += 1
    },
    showCoachmark: (payload: {
      title: string
      body: string
      dismissLabel: string
      leftX: number
      rightX: number
      bottomY: number
    }) => {
      state.showCoachmarkCalls.push(payload)
    },
    hideCoachmark: () => {
      state.hideCoachmarkCalls += 1
    },
    onCoachmarkDismissed: (cb: (payload: { kind: string }) => void) => {
      state.coachmarkDismissedCallbacks.push(cb)
      return () => {}
    },
    onCoachmarkAction: (cb: (payload: { kind: string }) => void) => {
      state.coachmarkActionCallbacks.push(cb)
      return () => {}
    },
    onCoachmarkAutoHidden: (cb: (payload: { kind: string }) => void) => {
      state.coachmarkAutoHiddenCallbacks.push(cb)
      return () => {}
    },
    onCoachmarkSettled: (cb: (payload: { kind: string }) => void) => {
      state.coachmarkSettledCallbacks.push(cb)
      return () => {}
    },
    onCoachmarkDisplaced: (cb: (payload: { kind: string }) => void) => {
      state.coachmarkDisplacedCallbacks.push(cb)
      return () => {}
    },
    ready: () => {
      state.readyCalls += 1
    }
  }
  ;(window as unknown as { __comfyTitleBar: typeof bridge }).__comfyTitleBar = bridge
  return state
}

describe('TitleBarApp', () => {
  let bridgeState: MockBridgeState

  beforeEach(() => {
    bridgeState = installMockBridge()
    vi.resetModules()
  })

  it('renders the app menu button and leaves the middle of a build window empty', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    const fileBtn = wrapper.find('.title-menu-button[aria-haspopup="menu"]')
    expect(fileBtn.exists()).toBe(true)
    expect(fileBtn.attributes('aria-label')).toBe('Menu')
    expect(fileBtn.classes()).toContain('title-menu-button--icon')
    expect(wrapper.find('.title-center').element.children.length).toBe(0)
    expect(wrapper.find('.title-install-pill').exists()).toBe(false)
  })

  it('signals readiness so main can push initial state', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    mount(TitleBarApp)
    await flushPromises()
    expect(bridgeState.readyCalls).toBe(1)
  })

  it('asks main to pop the native File menu when the File button is clicked', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('.title-menu-button[aria-haspopup="menu"]').trigger('click')
    expect(bridgeState.fileMenuAnchors.length).toBe(1)
    const anchor = bridgeState.fileMenuAnchors[0]!
    expect(typeof anchor.x).toBe('number')
    expect(typeof anchor.y).toBe('number')
    wrapper.unmount()
  })

  it('leaves the middle of the Desktop window empty', async () => {
    bridgeState = installMockBridge({ installationId: null })
    vi.resetModules()
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp, { attachTo: document.body })
    await flushPromises()
    bridgeState.titleChangedCallbacks.forEach((cb) => cb('Comfy Desktop'))
    await flushPromises()
    expect(wrapper.find('.title-center').element.children.length).toBe(0)
    expect(wrapper.find('.title-install-pill').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Comfy Desktop')
    wrapper.unmount()
  })

  it('shows the title main pushes on the first-use label, which is not a button', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.firstUseModeChangedCallbacks.forEach((cb) => cb('consent-lockdown'))
    bridgeState.titleChangedCallbacks.forEach((cb) => cb('MyInstall'))
    await flushPromises()
    const label = wrapper.find('.title-cluster .title-install-pill')
    expect(label.exists()).toBe(true)
    expect(label.attributes('role')).toBeUndefined()
    expect(label.attributes('tabindex')).toBeUndefined()
    expect(wrapper.find('.title-install-name').text()).toBe('MyInstall')
    expect(wrapper.find('.title-center').element.children.length).toBe(0)
  })

  it('does not render any title-bar nav buttons (back/forward chevrons removed with the takeover layout)', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    expect(wrapper.findAll('.title-nav-button').length).toBe(0)
  })

  it('applies the is-mac class when running on macOS', async () => {
    bridgeState = installMockBridge({ isMac: true })
    vi.resetModules()
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    expect(wrapper.find('header').classes()).toContain('is-mac')
  })

  it('suppresses menu re-open immediately after a menu close (click-to-toggle dismiss)', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp, { attachTo: document.body })
    await flushPromises()

    await wrapper.find('.title-menu-button[aria-haspopup="menu"]').trigger('click')
    expect(bridgeState.fileMenuAnchors.length).toBe(1)

    bridgeState.menuClosedCallbacks.forEach((cb) => cb({ menu: 'menu' }))
    await flushPromises()

    await wrapper.find('.title-menu-button[aria-haspopup="menu"]').trigger('click')
    expect(bridgeState.fileMenuAnchors.length).toBe(1)

    wrapper.unmount()
  })

  it('locks chrome through the first-use takeover and restores it during loading-lockdown', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    expect(wrapper.find('.title-menu-button[aria-haspopup="menu"]').exists()).toBe(true)
    expect(wrapper.find('.title-downloads-tray').exists()).toBe(true)
    expect(wrapper.find('.title-install-pill').exists()).toBe(false)
    expect(wrapper.find('header').classes()).not.toContain('is-consent-lockdown')

    bridgeState.firstUseModeChangedCallbacks.forEach((cb) => cb('consent-lockdown'))
    await flushPromises()
    expect(wrapper.find('header').classes()).toContain('is-consent-lockdown')
    expect(wrapper.find('.title-menu-button[aria-haspopup="menu"]').exists()).toBe(false)
    expect(wrapper.find('.title-downloads-tray').exists()).toBe(false)
    expect(wrapper.find('.title-install-pill').exists()).toBe(true)

    bridgeState.firstUseModeChangedCallbacks.forEach((cb) => cb('post-consent'))
    await flushPromises()
    expect(wrapper.find('header').classes()).not.toContain('is-consent-lockdown')
    expect(wrapper.find('.title-menu-button[aria-haspopup="menu"]').exists()).toBe(true)
    expect(wrapper.find('.title-downloads-tray').exists()).toBe(false)
    expect(wrapper.find('.title-install-pill').exists()).toBe(true)

    bridgeState.firstUseModeChangedCallbacks.forEach((cb) => cb('loading-lockdown'))
    await flushPromises()
    expect(wrapper.find('header').classes()).not.toContain('is-consent-lockdown')
    expect(wrapper.find('.title-menu-button[aria-haspopup="menu"]').exists()).toBe(true)
    expect(wrapper.find('.title-downloads-tray').exists()).toBe(true)
    expect(wrapper.find('.title-install-pill').exists()).toBe(false)

    bridgeState.firstUseModeChangedCallbacks.forEach((cb) => cb('none'))
    await flushPromises()
    expect(wrapper.find('header').classes()).not.toContain('is-consent-lockdown')
    expect(wrapper.find('.title-menu-button[aria-haspopup="menu"]').exists()).toBe(true)
    expect(wrapper.find('.title-downloads-tray').exists()).toBe(true)
    expect(wrapper.find('.title-install-pill').exists()).toBe(false)
    wrapper.unmount()
  })

  describe('the bell', () => {
    let settingsChanged: (data: { key: string }) => void = () => {}
    const settings = new Map<string, unknown>()
    let setSetting: ReturnType<typeof vi.fn>

    beforeEach(() => {
      settings.clear()
      setSetting = vi.fn(async (key: string, value: unknown) => {
        settings.set(key, value)
      })
      ;(window as unknown as { api: unknown }).api = {
        getSetting: vi.fn(async (key: string) => settings.get(key)),
        setSetting,
        onSettingsChanged: (cb: (data: { key: string }) => void) => {
          settingsChanged = cb
          return () => {}
        }
      }
    })

    it("opens the What's new menu under the bell and clears its dot", async () => {
      const { default: TitleBarApp } = await import('./TitleBarApp.vue')
      const wrapper = mount(TitleBarApp, { attachTo: document.body })
      await flushPromises()
      expect(wrapper.find('.title-announcement-dot').exists()).toBe(true)

      await wrapper.find('.title-announcement-button').trigger('click')

      expect(bridgeState.whatsNewMenuAnchors.length).toBe(1)
      expect(bridgeState.fileMenuAnchors.length).toBe(0)
      expect(setSetting).toHaveBeenCalledWith('comfyApiAnnouncementSeen', true)
      wrapper.unmount()
    })

    it('nudges the bell once when the tour ends', async () => {
      const { default: TitleBarApp } = await import('./TitleBarApp.vue')
      const wrapper = mount(TitleBarApp, { attachTo: document.body })
      await flushPromises()
      const bell = () => wrapper.find('.title-announcement-button')

      settings.set('homeTourDone', true)
      settingsChanged({ key: 'homeTourDone' })
      await expect.poll(() => bell().classes()).toContain('is-nudging')
      await expect.poll(() => bell().classes(), { timeout: 2000 }).not.toContain('is-nudging')
      wrapper.unmount()
    })

    it('does not nudge the bell when the tour is set to show again', async () => {
      const { default: TitleBarApp } = await import('./TitleBarApp.vue')
      const wrapper = mount(TitleBarApp, { attachTo: document.body })
      await flushPromises()

      settings.set('homeTourDone', false)
      settingsChanged({ key: 'homeTourDone' })
      await flushPromises()

      expect(wrapper.find('.title-announcement-button').classes()).not.toContain('is-nudging')
      wrapper.unmount()
    })
  })

  describe('Home button and the ☰ on the right', () => {
    const menuButton = '.title-menu-button[aria-haspopup="menu"]'

    it('puts Home alone on the left of a build window and sends the click to the Desktop window', async () => {
      const { default: TitleBarApp } = await import('./TitleBarApp.vue')
      const wrapper = mount(TitleBarApp)
      await flushPromises()
      bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb('local'))
      await flushPromises()

      const leading = wrapper.find('.title-cluster')
      const home = leading.find('.title-home-button')
      expect(home.exists()).toBe(true)
      expect(home.text()).toBe('Home')
      expect(leading.find(menuButton).exists()).toBe(false)
      expect(leading.find('.title-refresh-button').exists()).toBe(false)

      await home.trigger('click')
      expect(bridgeState.homeClicks).toBe(1)
      wrapper.unmount()
    })

    it("ends the right side with the ☰, after refresh, What's new and Downloads", async () => {
      const { default: TitleBarApp } = await import('./TitleBarApp.vue')
      const wrapper = mount(TitleBarApp)
      await flushPromises()
      bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb('local'))
      await flushPromises()

      const trailing = wrapper.find('.title-trailing').element
      const controls: [string, string][] = [
        ['.title-refresh-button', 'refresh'],
        ['.title-announcement-button', 'whats-new'],
        ['.title-downloads-tray', 'downloads'],
        [menuButton, 'menu']
      ]
      const order = Array.from(trailing.children).flatMap((el) =>
        controls.filter(([selector]) => el.matches(selector)).map(([, name]) => name)
      )
      expect(order).toEqual(['refresh', 'whats-new', 'downloads', 'menu'])
      wrapper.unmount()
    })

    it('shows no Home button in the Desktop window, and keeps its ☰ on the right', async () => {
      bridgeState = installMockBridge({ installationId: null })
      vi.resetModules()
      const { default: TitleBarApp } = await import('./TitleBarApp.vue')
      const wrapper = mount(TitleBarApp)
      await flushPromises()

      expect(wrapper.find('.title-home-button').exists()).toBe(false)
      expect(wrapper.find('.title-cluster').element.children.length).toBe(0)
      expect(wrapper.find('.title-trailing').element.lastElementChild?.matches(menuButton)).toBe(
        true
      )
      wrapper.unmount()
    })

    it('adds Home when the Desktop window starts a build in place', async () => {
      bridgeState = installMockBridge({ installationId: null })
      vi.resetModules()
      const { default: TitleBarApp } = await import('./TitleBarApp.vue')
      const wrapper = mount(TitleBarApp)
      await flushPromises()
      expect(wrapper.find('.title-home-button').exists()).toBe(false)

      bridgeState.installationIdChangedCallbacks.forEach((cb) => cb('inst-started-here'))
      await flushPromises()
      expect(wrapper.find('.title-home-button').exists()).toBe(true)
      wrapper.unmount()
    })

    it('hides Home through the first-use takeover and brings it back for loading', async () => {
      const { default: TitleBarApp } = await import('./TitleBarApp.vue')
      const wrapper = mount(TitleBarApp)
      await flushPromises()

      bridgeState.firstUseModeChangedCallbacks.forEach((cb) => cb('consent-lockdown'))
      await flushPromises()
      expect(wrapper.find('.title-home-button').exists()).toBe(false)

      bridgeState.firstUseModeChangedCallbacks.forEach((cb) => cb('post-consent'))
      await flushPromises()
      expect(wrapper.find('.title-home-button').exists()).toBe(false)

      bridgeState.firstUseModeChangedCallbacks.forEach((cb) => cb('loading-lockdown'))
      await flushPromises()
      expect(wrapper.find('.title-home-button').exists()).toBe(true)
      wrapper.unmount()
    })
  })

  it('toggles is-fullscreen in response to onFullscreenChanged', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.fullscreenChangedCallbacks.forEach((cb) => cb(true))
    await flushPromises()
    expect(wrapper.find('header').classes()).toContain('is-fullscreen')
    bridgeState.fullscreenChangedCallbacks.forEach((cb) => cb(false))
    await flushPromises()
    expect(wrapper.find('header').classes()).not.toContain('is-fullscreen')
  })

  function enterFirstUseTakeover(): Promise<void> {
    bridgeState.firstUseModeChangedCallbacks.forEach((cb) => cb('consent-lockdown'))
    return flushPromises()
  }

  it('hides the install-type icon by default until main pushes a category', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    await enterFirstUseTakeover()
    expect(wrapper.find('.title-install-type-icon').exists()).toBe(false)
  })

  it('renders the install-type icon when main pushes a recognized source category', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    await enterFirstUseTakeover()
    bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb('local'))
    await flushPromises()
    const icon = wrapper.find('.title-install-type-icon')
    expect(icon.exists()).toBe(true)
    expect(icon.attributes('title')).toBe('Standalone')
    expect(icon.attributes('aria-label')).toBe('Standalone')
  })

  it('switches the install-type icon tooltip when main pushes a different category', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    await enterFirstUseTakeover()
    bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb('cloud'))
    await flushPromises()
    expect(wrapper.find('.title-install-type-icon').attributes('title')).toBe('Cloud')
    bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb('remote'))
    await flushPromises()
    expect(wrapper.find('.title-install-type-icon').attributes('title')).toBe('Remote')
  })

  it('suppresses the install-type icon on install-less host windows even when a category arrives', async () => {
    bridgeState = installMockBridge({ installationId: null })
    vi.resetModules()
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    await enterFirstUseTakeover()
    bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb('local'))
    await flushPromises()
    expect(wrapper.find('.title-install-type-icon').exists()).toBe(false)
  })

  it('hides the install-type icon when main pushes null (e.g. unresolved source)', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    await enterFirstUseTakeover()
    bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb('local'))
    await flushPromises()
    expect(wrapper.find('.title-install-type-icon').exists()).toBe(true)
    bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb(null))
    await flushPromises()
    expect(wrapper.find('.title-install-type-icon').exists()).toBe(false)
  })

  it('renders the refresh button for local installs (parity with cloud)', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    expect(wrapper.find('.title-refresh-button').exists()).toBe(false)
    bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb('local'))
    await flushPromises()
    expect(wrapper.find('.title-refresh-button').exists()).toBe(true)
  })

  it('renders the refresh button for cloud and remote installs', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb('cloud'))
    await flushPromises()
    expect(wrapper.find('.title-refresh-button').exists()).toBe(true)
    bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb('remote'))
    await flushPromises()
    expect(wrapper.find('.title-refresh-button').exists()).toBe(true)
  })

  it('hides the refresh button when no category is set or it is unresolved', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb('local'))
    await flushPromises()
    expect(wrapper.find('.title-refresh-button').exists()).toBe(true)
    bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb(null))
    await flushPromises()
    expect(wrapper.find('.title-refresh-button').exists()).toBe(false)
  })

  it('hides the refresh button on install-less host windows', async () => {
    bridgeState = installMockBridge({ installationId: null })
    vi.resetModules()
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb('local'))
    await flushPromises()
    expect(wrapper.find('.title-refresh-button').exists()).toBe(false)
  })

  it('invokes clickRefreshInstance when the refresh button is clicked', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.sourceCategoryChangedCallbacks.forEach((cb) => cb('local'))
    await flushPromises()
    await wrapper.find('.title-refresh-button').trigger('click')
    expect(bridgeState.refreshInstanceClicks).toBe(1)
  })

  it('leaves the Desktop update to the sidebar and shows no update pill in the title bar', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    expect(bridgeState.appUpdateStateCallbacks).toHaveLength(0)
    expect(wrapper.find('.title-update-pill').exists()).toBe(false)
  })

  it('renders the downloads tray with no badge in the empty steady state', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    const tray = wrapper.find('.title-downloads-tray')
    expect(tray.exists()).toBe(true)
    expect(wrapper.find('.title-downloads-badge').exists()).toBe(false)
    expect(tray.attributes('title')).toBe('Downloads')
  })

  it('renders the downloads tray with a badge counter when there are in-flight downloads', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.downloadsChangedCallbacks.forEach((cb) =>
      cb({
        active: [
          {
            url: 'https://example.com/a.safetensors',
            filename: 'a.safetensors',
            directory: 'checkpoints',
            progress: 0.4,
            status: 'downloading'
          },
          {
            url: 'https://example.com/b.safetensors',
            filename: 'b.safetensors',
            directory: 'loras',
            progress: 0.1,
            status: 'pending'
          }
        ],
        recent: []
      })
    )
    await flushPromises()
    const tray = wrapper.find('.title-downloads-tray')
    expect(tray.exists()).toBe(true)
    const badge = wrapper.find('.title-downloads-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('2')
    expect(tray.attributes('title')).toBe('2 downloads in progress')
    expect(tray.attributes('aria-label')).toBe('2 downloads in progress')
  })

  it('treats recent entries already present on the first push as already-acknowledged', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.downloadsChangedCallbacks.forEach((cb) =>
      cb({
        active: [],
        recent: [
          {
            url: 'https://example.com/a.safetensors',
            filename: 'a.safetensors',
            directory: 'checkpoints',
            progress: 1,
            status: 'completed'
          }
        ]
      })
    )
    await flushPromises()
    expect(wrapper.find('.title-downloads-tray').exists()).toBe(true)
    expect(wrapper.find('.title-downloads-badge').exists()).toBe(false)
    expect(wrapper.find('.title-downloads-tray').classes()).not.toContain('has-unseen')
    expect(wrapper.find('.title-downloads-tray').attributes('title')).toBe('Downloads')
  })

  it('marks the tray as unseen when a download completes after the initial state', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.downloadsChangedCallbacks.forEach((cb) => cb({ active: [], recent: [] }))
    await flushPromises()
    bridgeState.downloadsChangedCallbacks.forEach((cb) =>
      cb({
        active: [
          {
            url: 'https://example.com/a.safetensors',
            filename: 'a.safetensors',
            progress: 0.4,
            status: 'downloading'
          }
        ],
        recent: []
      })
    )
    await flushPromises()
    bridgeState.downloadsChangedCallbacks.forEach((cb) =>
      cb({
        active: [],
        recent: [
          {
            url: 'https://example.com/a.safetensors',
            filename: 'a.safetensors',
            progress: 1,
            status: 'completed'
          }
        ]
      })
    )
    await flushPromises()
    const tray = wrapper.find('.title-downloads-tray')
    expect(tray.classes()).toContain('has-unseen')
    expect(tray.classes()).not.toContain('has-active')
    const badge = wrapper.find('.title-downloads-badge.is-unseen')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('1')
    expect(tray.attributes('title')).toBe('1 download finished. Click to review')
  })

  it('clears the unseen indicator when the downloads popup is opened', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.downloadsChangedCallbacks.forEach((cb) => cb({ active: [], recent: [] }))
    await flushPromises()
    bridgeState.downloadsChangedCallbacks.forEach((cb) =>
      cb({
        active: [],
        recent: [
          {
            url: 'https://example.com/a.safetensors',
            filename: 'a.safetensors',
            progress: 1,
            status: 'completed'
          }
        ]
      })
    )
    await flushPromises()
    expect(wrapper.find('.title-downloads-tray').classes()).toContain('has-unseen')
    bridgeState.menuOpenedCallbacks.forEach((cb) => cb({ menu: 'downloads' } as { menu: 'menu' }))
    await flushPromises()
    const tray = wrapper.find('.title-downloads-tray')
    expect(tray.classes()).not.toContain('has-unseen')
    expect(wrapper.find('.title-downloads-badge.is-unseen').exists()).toBe(false)
    expect(tray.attributes('title')).toBe('Downloads')
  })

  it('flashes the tray when a brand-new active download appears', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.downloadsChangedCallbacks.forEach((cb) => cb({ active: [], recent: [] }))
    await flushPromises()
    bridgeState.downloadsChangedCallbacks.forEach((cb) =>
      cb({
        active: [
          {
            url: 'https://example.com/a.safetensors',
            filename: 'a.safetensors',
            progress: 0.1,
            status: 'pending'
          }
        ],
        recent: []
      })
    )
    await flushPromises()
    expect(wrapper.find('.title-downloads-tray').classes()).toContain('is-flashing')
  })

  it('uses singular copy when exactly one download is in flight', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.downloadsChangedCallbacks.forEach((cb) =>
      cb({
        active: [
          {
            url: 'https://example.com/a.safetensors',
            filename: 'a.safetensors',
            directory: 'checkpoints',
            progress: 0.4,
            status: 'downloading'
          }
        ],
        recent: []
      })
    )
    await flushPromises()
    expect(wrapper.find('.title-downloads-tray').attributes('title')).toBe('1 download in progress')
  })

  it('clears the badge when the state transitions back to empty (button stays visible)', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.downloadsChangedCallbacks.forEach((cb) =>
      cb({
        active: [
          {
            url: 'https://example.com/a.safetensors',
            filename: 'a.safetensors',
            directory: 'checkpoints',
            progress: 0.5,
            status: 'downloading'
          }
        ],
        recent: []
      })
    )
    await flushPromises()
    expect(wrapper.find('.title-downloads-tray').exists()).toBe(true)
    expect(wrapper.find('.title-downloads-badge').exists()).toBe(true)
    bridgeState.downloadsChangedCallbacks.forEach((cb) => cb({ active: [], recent: [] }))
    await flushPromises()
    expect(wrapper.find('.title-downloads-tray').exists()).toBe(true)
    expect(wrapper.find('.title-downloads-badge').exists()).toBe(false)
  })

  it('forwards downloads-tray clicks through the bridge', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp, { attachTo: document.body })
    await flushPromises()
    bridgeState.downloadsChangedCallbacks.forEach((cb) =>
      cb({
        active: [
          {
            url: 'https://example.com/a.safetensors',
            filename: 'a.safetensors',
            directory: 'checkpoints',
            progress: 0.5,
            status: 'downloading'
          }
        ],
        recent: []
      })
    )
    await flushPromises()
    await wrapper.find('.title-downloads-tray').trigger('click')
    expect(bridgeState.downloadsTrayClicks).toBe(1)
    wrapper.unmount()
  })

  it('has no Send Feedback button', async () => {
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    expect(wrapper.find('.title-announcement-button').exists()).toBe(true)
    expect(wrapper.find('.title-feedback-button').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Feedback"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('renders the downloads tray on install-less (chooser-host) windows too — downloads are global, not per-install', async () => {
    bridgeState = installMockBridge({ installationId: null })
    vi.resetModules()
    const { default: TitleBarApp } = await import('./TitleBarApp.vue')
    const wrapper = mount(TitleBarApp)
    await flushPromises()
    bridgeState.downloadsChangedCallbacks.forEach((cb) =>
      cb({
        active: [
          {
            url: 'https://example.com/a.safetensors',
            filename: 'a.safetensors',
            directory: 'checkpoints',
            progress: 0.5,
            status: 'downloading'
          }
        ],
        recent: []
      })
    )
    await flushPromises()
    expect(wrapper.find('.title-downloads-tray').exists()).toBe(true)
  })

  it('does NOT route hover through showTooltip on Win/Linux (native title is reliable there)', async () => {
    bridgeState = installMockBridge({ isMac: false })
    vi.resetModules()
    vi.useFakeTimers()
    try {
      const { default: TitleBarApp } = await import('./TitleBarApp.vue')
      const wrapper = mount(TitleBarApp, { attachTo: document.body })
      await flushPromises()
      const btn = wrapper.find('.title-menu-button[aria-haspopup="menu"]').element as HTMLElement
      btn.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
      vi.advanceTimersByTime(1000)
      await flushPromises()
      expect(bridgeState.showTooltipCalls.length).toBe(0)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits `title` only on Win/Linux and `data-title-tooltip` only on macOS so the two tooltip systems can never both fire', async () => {
    bridgeState = installMockBridge({ isMac: true })
    vi.resetModules()
    {
      const { default: TitleBarApp } = await import('./TitleBarApp.vue')
      const wrapper = mount(TitleBarApp)
      await flushPromises()
      const btn = wrapper.find('.title-menu-button[aria-haspopup="menu"]')
      expect(btn.attributes('aria-label')).toBe('Menu')
      expect(btn.attributes('data-title-tooltip')).toBe('Menu')
      expect(btn.attributes('title')).toBeUndefined()
      wrapper.unmount()
    }
    bridgeState = installMockBridge({ isMac: false })
    vi.resetModules()
    {
      const { default: TitleBarApp } = await import('./TitleBarApp.vue')
      const wrapper = mount(TitleBarApp)
      await flushPromises()
      const btn = wrapper.find('.title-menu-button[aria-haspopup="menu"]')
      expect(btn.attributes('aria-label')).toBe('Menu')
      expect(btn.attributes('title')).toBe('Menu')
      expect(btn.attributes('data-title-tooltip')).toBeUndefined()
      wrapper.unmount()
    }
  })

  it('routes hover through showTooltip on macOS, with the trigger text and anchor', async () => {
    bridgeState = installMockBridge({ isMac: true })
    vi.resetModules()
    vi.useFakeTimers()
    try {
      const { default: TitleBarApp } = await import('./TitleBarApp.vue')
      const wrapper = mount(TitleBarApp, { attachTo: document.body })
      await flushPromises()
      const btn = wrapper.find('.title-menu-button[aria-haspopup="menu"]').element as HTMLElement
      btn.getBoundingClientRect = () =>
        ({ left: 20, top: 6, right: 50, bottom: 30, width: 30, height: 24, x: 20, y: 6 }) as DOMRect
      btn.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
      vi.advanceTimersByTime(500)
      await flushPromises()
      expect(bridgeState.showTooltipCalls.length).toBe(1)
      const call = bridgeState.showTooltipCalls[0]
      expect(call.text).toBe('Menu')
      expect(call.leftX).toBe(20)
      expect(call.rightX).toBe(50)
      expect(call.bottomY).toBe(30)
      const root = wrapper.find('header').element as HTMLElement
      root.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
      document.documentElement.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
      await flushPromises()
      expect(bridgeState.hideTooltipCalls).toBeGreaterThanOrEqual(1)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  describe('core beta activation notice', () => {
    let getPendingBetaNotice: ReturnType<typeof vi.fn>
    let acknowledgeBetaNotice: ReturnType<typeof vi.fn>
    let openGlobalSettings: ReturnType<typeof vi.fn>
    let setSetting: ReturnType<typeof vi.fn>

    function installApiMock(
      opts: {
        pending?: {
          args: string[]
          direction: 'enabled' | 'disabled'
          description: string | null
        } | null
      } = {}
    ): void {
      const pending =
        opts.pending === undefined
          ? { args: ['--enable-assets'], direction: 'enabled' as const, description: null }
          : opts.pending
      getPendingBetaNotice = vi.fn().mockResolvedValue(pending)
      acknowledgeBetaNotice = vi.fn().mockResolvedValue(undefined)
      openGlobalSettings = vi.fn()
      setSetting = vi.fn().mockResolvedValue(undefined)
      ;(window as unknown as { api: unknown }).api = {
        getSetting: vi.fn().mockResolvedValue(undefined),
        setSetting,
        getPendingBetaNotice,
        acknowledgeBetaNotice,
        openGlobalSettings
      }
    }

    beforeEach(() => {
      installApiMock()
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0)
        return 0
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
      delete (window as unknown as { api?: unknown }).api
    })

    async function mountBar(installationId: string | null = 'inst-1') {
      bridgeState = installMockBridge({ installationId })
      vi.resetModules()
      const { default: TitleBarApp } = await import('./TitleBarApp.vue')
      const wrapper = mount(TitleBarApp, { attachTo: document.body })
      await flushPromises()
      return wrapper
    }

    const betaCards = () => bridgeState.showCoachmarkCalls.filter((c) => c.kind === 'beta-notice')

    it('shows the notice anchored at the news bell when main has one pending', async () => {
      const wrapper = await mountBar()
      expect(getPendingBetaNotice).toHaveBeenCalledWith('inst-1')
      expect(betaCards().length).toBe(1)
      const payload = betaCards()[0]!
      expect(payload.title).toBe('A beta feature is on')
      expect(payload.body).not.toContain('--enable-assets')
      expect(payload.actionLabel).toBe('Settings')
      wrapper.unmount()
    })

    it('stays silent when main has nothing pending', async () => {
      installApiMock({ pending: null })
      const wrapper = await mountBar()
      expect(betaCards().length).toBe(0)
      wrapper.unmount()
    })

    it('stays silent on an install-less (dashboard) window, which launched nothing', async () => {
      const wrapper = await mountBar(null)
      expect(getPendingBetaNotice).not.toHaveBeenCalled()
      expect(betaCards().length).toBe(0)
      wrapper.unmount()
    })

    it('acknowledges on dismiss so the notice never returns', async () => {
      const wrapper = await mountBar()
      bridgeState.coachmarkDismissedCallbacks.forEach((cb) => cb({ kind: 'beta-notice' }))
      await flushPromises()
      expect(acknowledgeBetaNotice).toHaveBeenCalledWith('inst-1', ['--enable-assets'])
      expect(bridgeState.hideCoachmarkCalls).toBeGreaterThan(0)
      wrapper.unmount()
    })

    it('does not put the card back until the window has stopped moving', async () => {
      const wrapper = await mountBar()
      expect(betaCards().length).toBe(1)

      bridgeState.coachmarkAutoHiddenCallbacks.forEach((cb) => cb({ kind: 'beta-notice' }))
      bridgeState.coachmarkAutoHiddenCallbacks.forEach((cb) => cb({ kind: 'beta-notice' }))
      bridgeState.coachmarkAutoHiddenCallbacks.forEach((cb) => cb({ kind: 'beta-notice' }))
      await flushPromises()
      expect(betaCards().length).toBe(1)

      bridgeState.coachmarkSettledCallbacks.forEach((cb) => cb({ kind: 'beta-notice' }))
      await flushPromises()

      expect(betaCards().length).toBe(2)
      expect(acknowledgeBetaNotice).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('forgets a card the other one displaced, so it can be raised again', async () => {
      const wrapper = await mountBar()
      expect(betaCards().length).toBe(1)

      bridgeState.coachmarkDisplacedCallbacks.forEach((cb) => cb({ kind: 'beta-notice' }))
      await flushPromises()

      expect(acknowledgeBetaNotice).not.toHaveBeenCalled()

      getPendingBetaNotice.mockResolvedValue({
        args: ['--enable-something-else'],
        direction: 'enabled',
        description: null
      })
      bridgeState.coachmarkSettledCallbacks.forEach((cb) => cb({ kind: 'beta-notice' }))
      await flushPromises()
      expect(betaCards().length).toBe(2)
      wrapper.unmount()
    })

    it('opens Settings on the beta opt-in row and retires the card in one click', async () => {
      const wrapper = await mountBar()
      bridgeState.coachmarkActionCallbacks.forEach((cb) => cb({ kind: 'beta-notice' }))
      await flushPromises()
      expect(openGlobalSettings).toHaveBeenCalledWith('general', {
        highlightField: 'betaFeaturesEnabled'
      })
      expect(acknowledgeBetaNotice).toHaveBeenCalledWith('inst-1', ['--enable-assets'])
      wrapper.unmount()
    })

    it('never acknowledges an install the card was not raised for', async () => {
      getPendingBetaNotice.mockImplementation(async (id: string) =>
        id === 'inst-1'
          ? { args: ['--enable-assets'], direction: 'enabled', description: null }
          : null
      )
      const wrapper = await mountBar()
      expect(betaCards().length).toBe(1)

      bridgeState.installationIdChangedCallbacks.forEach((cb) => cb('inst-2'))
      await flushPromises()
      expect(acknowledgeBetaNotice).not.toHaveBeenCalled()
      expect(betaCards().length).toBe(1)

      bridgeState.coachmarkDismissedCallbacks.forEach((cb) => cb({ kind: 'beta-notice' }))
      await flushPromises()
      expect(acknowledgeBetaNotice).not.toHaveBeenCalledWith('inst-2', expect.anything())
      wrapper.unmount()
    })

    it('queries the NEW install after the host retargets between two real instances', async () => {
      getPendingBetaNotice.mockImplementation(async (id: string) =>
        id === 'inst-2'
          ? { args: ['--enable-agent'], direction: 'enabled', description: null }
          : null
      )
      const wrapper = await mountBar()
      expect(betaCards().length).toBe(0)

      bridgeState.installationIdChangedCallbacks.forEach((cb) => cb('inst-2'))
      await flushPromises()

      expect(getPendingBetaNotice).toHaveBeenCalledWith('inst-2')
      expect(betaCards().length).toBe(1)
      wrapper.unmount()
    })

    it('shows a SECOND, different notice for the same install after the first is retired', async () => {
      const wrapper = await mountBar()
      expect(betaCards().length).toBe(1)

      getPendingBetaNotice.mockResolvedValue({
        args: ['--enable-agent'],
        direction: 'enabled',
        description: null
      })
      bridgeState.coachmarkDismissedCallbacks.forEach((cb) => cb({ kind: 'beta-notice' }))
      await flushPromises()
      expect(acknowledgeBetaNotice).toHaveBeenCalledWith('inst-1', ['--enable-assets'])

      bridgeState.firstUseModeChangedCallbacks.forEach((cb) => cb('loading-lockdown'))
      await flushPromises()
      bridgeState.firstUseModeChangedCallbacks.forEach((cb) => cb('none'))
      await flushPromises()

      expect(betaCards().length).toBe(2)
      wrapper.unmount()
    })

    it('does not re-raise the same card when acknowledging it failed', async () => {
      acknowledgeBetaNotice.mockRejectedValue(new Error('ipc down'))
      const wrapper = await mountBar()
      expect(betaCards().length).toBe(1)

      bridgeState.coachmarkDismissedCallbacks.forEach((cb) => cb({ kind: 'beta-notice' }))
      await flushPromises()
      bridgeState.firstUseModeChangedCallbacks.forEach((cb) => cb('loading-lockdown'))
      await flushPromises()
      bridgeState.firstUseModeChangedCallbacks.forEach((cb) => cb('none'))
      await flushPromises()

      expect(betaCards().length).toBe(1)
      wrapper.unmount()
    })

    it('names the feature when the PostHog payload supplied a name', async () => {
      installApiMock({
        pending: { args: ['--enable-assets'], direction: 'enabled', description: 'Asset library' }
      })
      const wrapper = await mountBar()
      const payload = betaCards()[0]!
      expect(payload.title).toBe('The Asset library beta is on')
      expect(payload.body).toContain('Asset library')
      wrapper.unmount()
    })

    it('reads the other way round for a named remote force-off', async () => {
      installApiMock({
        pending: {
          args: ['--disable-assets'],
          direction: 'disabled',
          description: 'Asset library'
        }
      })
      const wrapper = await mountBar()
      const payload = betaCards()[0]!
      expect(payload.title).toBe('The Asset library beta is off')
      expect(payload.title).not.toContain('is on')
      expect(payload.actionLabel).toBe('Settings')
      wrapper.unmount()
    })
  })
})
