import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcHandlers = new Map<
  string,
  (event: { sender: { id: number } }, payload?: unknown) => void
>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: {
    handle: vi.fn(),
    on: (
      channel: string,
      handler: (event: { sender: { id: number } }, payload?: unknown) => void
    ) => ipcHandlers.set(channel, handler),
    off: vi.fn()
  },
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

const POPUP_WEB_CONTENTS_ID = 77
const TITLE_BAR_WEB_CONTENTS_ID = 11

const fakeViews: FakePopupView[] = []

class FakePopupView {
  visible = false
  rendererReady = true
  pendingShowTimer: (() => void) | null = null
  readonly parentWindow: FakeParent
  readonly parentWindowId: number
  readonly popupWebContentsId = POPUP_WEB_CONTENTS_ID
  readonly popup = {
    webContents: { send: vi.fn(), isDestroyed: () => false },
    getBounds: () => ({ x: 0, y: 0, width: 300, height: 96 }),
    setBounds: vi.fn()
  }
  private readonly onHide?: () => void

  constructor(opts: { parent: FakeParent; onHide?: () => void }) {
    this.parentWindow = opts.parent
    this.parentWindowId = opts.parent.id
    this.onHide = opts.onHide
    fakeViews.push(this)
  }

  isDestroyed(): boolean {
    return false
  }

  showOnTop(): void {
    this.pendingShowTimer = null
    this.visible = true
  }

  hide(): void {
    if (!this.visible && !this.pendingShowTimer) return
    this.visible = false
    this.pendingShowTimer = null
    this.onHide?.()
  }

  scheduleShowFallback(_timeoutMs: number, callback: () => void): void {
    this.pendingShowTimer = callback
  }
}

vi.mock('./embeddedPopupView', () => ({ EmbeddedPopupView: FakePopupView }))

interface FakeParent {
  id: number
  isDestroyed: () => boolean
  getContentBounds: () => { x: number; y: number; width: number; height: number }
  on: () => void
}

const { registerTitleCoachmarkIpc } = await import('./titleCoachmark')

const parent: FakeParent = {
  id: 5,
  isDestroyed: () => false,
  getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
  on: () => {}
}
const titleBar = { id: TITLE_BAR_WEB_CONTENTS_ID, isDestroyed: () => false, send: vi.fn() }

registerTitleCoachmarkIpc({
  findParentByTitleBarSender: () => parent as unknown as Electron.BrowserWindow,
  findTitleBarByParent: () => titleBar as unknown as Electron.WebContents
})

function send(channel: string, senderId: number, payload?: unknown): void {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`no ipc handler for ${channel}`)
  handler({ sender: { id: senderId } }, payload)
}

function showCard(): string {
  send('comfy-window:show-titlebar-coachmark', TITLE_BAR_WEB_CONTENTS_ID, {
    title: 'A beta feature is on',
    body: 'body',
    dismissLabel: 'Got it',
    actionLabel: 'Settings',
    leftX: 100,
    rightX: 140,
    bottomY: 40
  })
  const view = fakeViews.at(-1)!
  const config = view.popup.webContents.send.mock.calls
    .filter(([channel]) => channel === 'comfy-titletooltip:set-config')
    .at(-1)?.[1] as { configToken: string }
  return config.configToken
}

function rendered(configToken: string): void {
  send('comfy-titletooltip:rendered', POPUP_WEB_CONTENTS_ID, {
    width: 260,
    height: 80,
    configToken
  })
}

describe('hiding the coachmark', () => {
  beforeEach(() => {
    const view = fakeViews.at(-1)
    if (view) view.hide()
  })

  it('shows the card once its page reports it drew', () => {
    const token = showCard()
    rendered(token)
    expect(fakeViews.at(-1)!.visible).toBe(true)
  })

  it('keeps the card hidden when a late draw report arrives after a hide', () => {
    const token = showCard()
    rendered(token)
    send('comfy-window:hide-titlebar-coachmark', TITLE_BAR_WEB_CONTENTS_ID)
    expect(fakeViews.at(-1)!.visible).toBe(false)

    rendered(token)
    expect(fakeViews.at(-1)!.visible).toBe(false)
  })

  it('keeps the card hidden when the hide lands before the first draw report', () => {
    const token = showCard()
    send('comfy-window:hide-titlebar-coachmark', TITLE_BAR_WEB_CONTENTS_ID)
    rendered(token)
    expect(fakeViews.at(-1)!.visible).toBe(false)
  })

  it('shows the card again when it is opened after a hide', () => {
    const first = showCard()
    rendered(first)
    send('comfy-window:hide-titlebar-coachmark', TITLE_BAR_WEB_CONTENTS_ID)

    const second = showCard()
    rendered(second)
    expect(fakeViews.at(-1)!.visible).toBe(true)
  })
})
