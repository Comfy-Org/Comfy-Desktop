import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  comfyHost: null as {
    installationId: string | null
    comfyUrl: string
    sourceCategory: string
  } | null,
  logsWindowInstall: null as string | null,
  isPanelSender: vi.fn(() => false),
  findEntryByTitleBarSender: vi.fn((): unknown => null),
  isTrustedSender: vi.fn(() => false),
  isAppsPageSender: vi.fn(() => false)
}))

vi.mock('../../host/registry', () => ({
  findEntryByComfySender: () => mocks.comfyHost,
  findEntryByTitleBarSender: mocks.findEntryByTitleBarSender,
  isPanelSender: mocks.isPanelSender
}))
vi.mock('../../apps/appsPages', () => ({ isAppsPageSender: mocks.isAppsPageSender }))
vi.mock('../embeddedSession', () => ({ isTrustedSender: mocks.isTrustedSender }))
vi.mock('../logsPopoutWindow', () => ({
  findLogsPopoutInstallationIdBySender: () => mocks.logsWindowInstall
}))

import {
  anyOf,
  installOfLogsWindow,
  installPage,
  installShownTo,
  logsWindow,
  panelOrTitleBar,
  sessionPage,
  trustedCloudPage
} from './bridgeCallers'
import type { BridgeCaller } from './bridgeCallers'

const INSTALL_URL = 'http://127.0.0.1:8188'
const CLOUD_URL = 'https://cloud.comfy.org/'
const ELSEWHERE = 'https://elsewhere.example.test/'

type Frame = 'main' | 'subframe' | 'gone'

function callerOn(url: string, frame: Frame = 'main'): BridgeCaller {
  const mainFrame = { processId: 3, routingId: 1, url }
  const senderFrames = {
    main: { processId: 3, routingId: 1, url },
    subframe: { processId: 3, routingId: 2, url },
    gone: null
  }
  return { sender: { mainFrame }, senderFrame: senderFrames[frame] } as unknown as BridgeCaller
}

function showInstall(comfyUrl = INSTALL_URL, sourceCategory = 'local'): void {
  mocks.comfyHost = { installationId: 'inst-1', comfyUrl, sourceCategory }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.comfyHost = null
  mocks.logsWindowInstall = null
})

describe("a page on the install's own site", () => {
  it('is the top page of a ComfyUI view that shows its install', () => {
    showInstall()

    expect(installPage(callerOn(`${INSTALL_URL}/?workflow=1`))).toBe(true)
    expect(installShownTo(callerOn(`${INSTALL_URL}/`))?.installationId).toBe('inst-1')
  })

  it.each([
    ['another site the view was sent to', callerOn(ELSEWHERE)],
    ['another port on the same computer', callerOn('http://127.0.0.1:9000/')],
    ['a frame embedded in the page', callerOn(`${INSTALL_URL}/`, 'subframe')],
    ['a page that has already gone', callerOn(`${INSTALL_URL}/`, 'gone')],
    ['the splash shown while ComfyUI restarts', callerOn('data:text/html,splash')]
  ])('is not %s', (_what, caller) => {
    showInstall()

    expect(installPage(caller)).toBe(false)
    expect(installShownTo(caller)).toBeNull()
  })

  it('is not a view whose window shows no install', () => {
    mocks.comfyHost = { installationId: null, comfyUrl: '', sourceCategory: 'local' }

    expect(installPage(callerOn(`${INSTALL_URL}/`))).toBe(false)
  })

  it('is not a page outside every ComfyUI view', () => {
    expect(installPage(callerOn(`${INSTALL_URL}/`))).toBe(false)
  })
})

describe('a trusted Comfy Cloud page', () => {
  it('is the top page of the Cloud install on a Comfy Cloud host', () => {
    showInstall(CLOUD_URL, 'cloud')

    expect(trustedCloudPage(callerOn(CLOUD_URL))).toBe(true)
  })

  it.each(['remote', 'local'])('is not a %s install, whatever it serves', (sourceCategory) => {
    showInstall(CLOUD_URL, sourceCategory)

    expect(trustedCloudPage(callerOn(CLOUD_URL))).toBe(false)
  })

  it.each([
    ['another site', callerOn(ELSEWHERE)],
    ['a frame embedded in the Cloud page', callerOn(CLOUD_URL, 'subframe')],
    ['a page that has already gone', callerOn(CLOUD_URL, 'gone')]
  ])('is not %s', (_what, caller) => {
    showInstall(CLOUD_URL, 'cloud')

    expect(trustedCloudPage(caller)).toBe(false)
  })
})

describe('the logs window', () => {
  it("is the window Desktop opened, showing Desktop's own page", () => {
    mocks.logsWindowInstall = 'inst-1'

    expect(logsWindow(callerOn('data:text/html;charset=utf-8,logs'))).toBe(true)
    expect(installOfLogsWindow(callerOn('data:text/html;charset=utf-8,logs'))).toBe('inst-1')
  })

  it('stops counting once it shows a website', () => {
    mocks.logsWindowInstall = 'inst-1'

    expect(logsWindow(callerOn(ELSEWHERE))).toBe(false)
    expect(installOfLogsWindow(callerOn(ELSEWHERE))).toBeNull()
  })

  it('is no other window', () => {
    expect(logsWindow(callerOn('data:text/html;charset=utf-8,logs'))).toBe(false)
  })
})

describe("Desktop's own panel and title bar", () => {
  it('are recognised by the view they run in', () => {
    const caller = callerOn('file:///app/out/renderer/panel.html')

    expect(panelOrTitleBar(caller)).toBe(false)

    mocks.isPanelSender.mockReturnValueOnce(true)
    expect(panelOrTitleBar(caller)).toBe(true)

    mocks.findEntryByTitleBarSender.mockReturnValueOnce({ id: 1 })
    expect(panelOrTitleBar(caller)).toBe(true)
  })
})

describe('a page that may use the Desktop sign-in', () => {
  it('is a local ComfyUI page or a hosted app page, and nothing else', () => {
    const caller = callerOn(`${INSTALL_URL}/`)

    expect(sessionPage(caller)).toBe(false)

    mocks.isTrustedSender.mockReturnValueOnce(true)
    expect(sessionPage(caller)).toBe(true)

    mocks.isAppsPageSender.mockReturnValueOnce(true)
    expect(sessionPage(caller)).toBe(true)
    expect(mocks.isAppsPageSender).toHaveBeenLastCalledWith(caller.sender, caller.senderFrame)
  })
})

describe('a rule that accepts several kinds of caller', () => {
  it('lets a caller through when any one of them does', () => {
    const caller = callerOn(ELSEWHERE)
    const never = (): boolean => false
    const always = (): boolean => true

    expect(anyOf(never, always)(caller)).toBe(true)
    expect(anyOf(never, never)(caller)).toBe(false)
  })
})
