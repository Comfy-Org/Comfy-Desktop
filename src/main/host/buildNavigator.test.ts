import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComfyWindowEntry } from './registry'

const splash = vi.hoisted(() => ({
  show: vi.fn<(contents: unknown, theme: unknown, copy?: unknown) => Promise<void>>()
}))

vi.mock('../lib/relaunchPage', () => ({ showSplashPage: splash.show }))

import { LOAD_RETRY_DELAY_MS, navigatorFor } from './buildNavigator'
import { SPLASH_DARK } from '../lib/theme'

const BUILD_URL = 'http://127.0.0.1:8188'
const TEAM_A_URL = 'https://cloud.comfy.org/?workspace=team-a'
const TEAM_B_URL = 'https://cloud.comfy.org/?workspace=team-b'
const ABORTED = new Error('ERR_ABORTED (-3)')
const OFFLINE = new Error('ERR_INTERNET_DISCONNECTED (-106)')

function openBuildWindow() {
  const pending = new Map<string, PromiseWithResolvers<void>>()
  const loadURL = vi.fn((url: string) => {
    const load = Promise.withResolvers<void>()
    pending.set(url, load)
    return load.promise
  })
  const stop = vi.fn()
  const state = { windowDestroyed: false, held: false, reloadUrl: BUILD_URL }
  const entry = {
    window: { isDestroyed: () => state.windowDestroyed },
    comfyView: { webContents: { loadURL, stop, isDestroyed: () => state.windowDestroyed } }
  } as unknown as ComfyWindowEntry
  const navigator = navigatorFor(entry)
  navigator.attach({ reloadUrl: () => state.reloadUrl, mayReload: () => !state.held })
  return {
    navigator,
    loadURL,
    stop,
    state,
    finish: (url: string) => pending.get(url)!.resolve(),
    fail: (url: string, error: Error) => pending.get(url)!.reject(error),
    loaded: () => loadURL.mock.calls.map(([url]) => url)
  }
}

function splashOnScreen(): PromiseWithResolvers<void> {
  const shown = Promise.withResolvers<void>()
  splash.show.mockReturnValueOnce(shown.promise)
  return shown
}

const reopenCopy = { title: 'Starting', desc: 'One moment' }

async function unhandledRejectionsAfter(act: () => void): Promise<unknown[]> {
  const unhandled: unknown[] = []
  const record = (reason: unknown): void => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', record)
  try {
    act()
    vi.useRealTimers()
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    process.off('unhandledRejection', record)
  }
  return unhandled
}

beforeEach(() => {
  vi.useFakeTimers()
  splash.show.mockReset()
  splash.show.mockResolvedValue()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('opening an address in a build window', () => {
  it('reports the page as loaded once it finishes', async () => {
    const { navigator, finish } = openBuildWindow()

    const opened = navigator.open(BUILD_URL)
    finish(BUILD_URL)

    await expect(opened).resolves.toBe('loaded')
  })

  it('fails when the newest request cannot load', async () => {
    const { navigator, fail } = openBuildWindow()

    const opened = navigator.open(BUILD_URL)
    fail(BUILD_URL, OFFLINE)

    await expect(opened).rejects.toBe(OFFLINE)
  })

  it('gives way without an error when a newer request interrupts it', async () => {
    const { navigator, fail, finish } = openBuildWindow()

    const first = navigator.open(TEAM_A_URL)
    const second = navigator.open(TEAM_B_URL)
    fail(TEAM_A_URL, ABORTED)
    finish(TEAM_B_URL)

    await expect(first).resolves.toBe('superseded')
    await expect(second).resolves.toBe('loaded')
  })

  it('does not claim a page that finished after a newer request began', async () => {
    const { navigator, finish } = openBuildWindow()

    const first = navigator.open(TEAM_A_URL)
    const second = navigator.open(TEAM_B_URL)
    finish(TEAM_A_URL)
    finish(TEAM_B_URL)

    await expect(first).resolves.toBe('superseded')
    await expect(second).resolves.toBe('loaded')
  })
})

describe('opening an address nobody waits for', () => {
  it('loads the address', () => {
    const { navigator, loaded } = openBuildWindow()

    navigator.startOpening(BUILD_URL)

    expect(loaded()).toEqual([BUILD_URL])
  })

  it('leaves a page that cannot load to the retry instead of reporting an unhandled error', async () => {
    const { navigator, fail } = openBuildWindow()
    navigator.startOpening(BUILD_URL)

    const unhandled = await unhandledRejectionsAfter(() => fail(BUILD_URL, OFFLINE))

    expect(unhandled).toEqual([])
  })
})

describe('refreshing a build window', () => {
  it('stops the page and reloads the build address', () => {
    const { navigator, stop, loadURL } = openBuildWindow()

    navigator.refresh()

    expect(stop).toHaveBeenCalledBefore(loadURL)
    expect(loadURL).toHaveBeenCalledExactlyOnceWith(BUILD_URL)
  })

  it('takes over from a workspace switch that is still loading without reporting a failure', async () => {
    const { navigator, fail, loaded } = openBuildWindow()

    const workspaceSwitch = navigator.open(TEAM_A_URL)
    navigator.refresh()
    fail(TEAM_A_URL, ABORTED)

    await expect(workspaceSwitch).resolves.toBe('superseded')
    expect(loaded()).toEqual([TEAM_A_URL, BUILD_URL])
  })

  it('leaves a refresh that cannot load to the retry instead of reporting an unhandled error', async () => {
    const { navigator, fail } = openBuildWindow()
    navigator.refresh()

    const unhandled = await unhandledRejectionsAfter(() => fail(BUILD_URL, OFFLINE))

    expect(unhandled).toEqual([])
  })

  it.each([
    ['the build is restarting', { held: true }],
    ['the window has closed', { windowDestroyed: true }]
  ])('does nothing while %s', (_reason, change) => {
    const { navigator, state, loadURL } = openBuildWindow()
    Object.assign(state, change)

    navigator.refresh()

    expect(loadURL).not.toHaveBeenCalled()
  })

  it('does nothing once the build has left the window', () => {
    const { navigator, loadURL } = openBuildWindow()
    navigator.detach()

    navigator.refresh()

    expect(loadURL).not.toHaveBeenCalled()
  })
})

describe('retrying after a page fails to load', () => {
  it('reloads the build address after the retry delay', () => {
    const { navigator, loaded } = openBuildWindow()

    navigator.retryAfterFailure()
    expect(navigator.retryPending).toBe(true)
    vi.advanceTimersByTime(LOAD_RETRY_DELAY_MS)

    expect(loaded()).toEqual([BUILD_URL])
    expect(navigator.retryPending).toBe(false)
  })

  it('leaves a retry that cannot load to the next retry instead of reporting an unhandled error', async () => {
    const { navigator, fail } = openBuildWindow()
    navigator.retryAfterFailure()
    vi.advanceTimersByTime(LOAD_RETRY_DELAY_MS)

    const unhandled = await unhandledRejectionsAfter(() => fail(BUILD_URL, OFFLINE))

    expect(unhandled).toEqual([])
  })

  it('retries once however many failures arrive before it runs', () => {
    const { navigator, loadURL } = openBuildWindow()

    navigator.retryAfterFailure()
    navigator.retryAfterFailure()
    vi.advanceTimersByTime(LOAD_RETRY_DELAY_MS)

    expect(loadURL).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      'a workspace switch',
      (navigator: ReturnType<typeof navigatorFor>) => navigator.open(TEAM_A_URL)
    ],
    ['a refresh', (navigator: ReturnType<typeof navigatorFor>) => navigator.refresh()],
    [
      'a restart splash',
      (navigator: ReturnType<typeof navigatorFor>) => navigator.showSplash(SPLASH_DARK)
    ],
    [
      'keeping the page that is already open',
      (navigator: ReturnType<typeof navigatorFor>) => navigator.keepCurrentPage()
    ],
    [
      'the build leaving the window',
      (navigator: ReturnType<typeof navigatorFor>) => navigator.detach()
    ]
  ])('drops the retry when %s comes first', (_newer, request) => {
    const { navigator, loadURL } = openBuildWindow()

    navigator.retryAfterFailure()
    void request(navigator)
    const loadsBeforeRetryDelay = loadURL.mock.calls.length
    vi.advanceTimersByTime(LOAD_RETRY_DELAY_MS)

    expect(loadURL).toHaveBeenCalledTimes(loadsBeforeRetryDelay)
    expect(navigator.retryPending).toBe(false)
  })

  it('does not schedule a retry while the build is restarting', () => {
    const { navigator, state, loadURL } = openBuildWindow()
    state.held = true

    navigator.retryAfterFailure()
    vi.advanceTimersByTime(LOAD_RETRY_DELAY_MS)

    expect(navigator.retryPending).toBe(false)
    expect(loadURL).not.toHaveBeenCalled()
  })

  it.each([
    ['the build started restarting', { held: true }],
    ['the window closed', { windowDestroyed: true }]
  ])('skips the retry when %s before it ran', (_reason, change) => {
    const { navigator, state, loadURL } = openBuildWindow()

    navigator.retryAfterFailure()
    Object.assign(state, change)
    vi.advanceTimersByTime(LOAD_RETRY_DELAY_MS)

    expect(loadURL).not.toHaveBeenCalled()
  })

  it('schedules a fresh retry when the newer request fails too', () => {
    const { navigator, loaded } = openBuildWindow()

    navigator.retryAfterFailure()
    void navigator.open(TEAM_A_URL).catch(() => {})
    navigator.retryAfterFailure()
    vi.advanceTimersByTime(LOAD_RETRY_DELAY_MS)

    expect(loaded()).toEqual([TEAM_A_URL, BUILD_URL])
  })
})

describe('reopening a build behind the launch splash', () => {
  it('reveals the window and loads the build once the splash is up', async () => {
    const { navigator, loaded } = openBuildWindow()
    const reveal = vi.fn(() => true)

    await navigator.reopenBehindSplash({
      url: BUILD_URL,
      theme: SPLASH_DARK,
      copy: reopenCopy,
      reveal
    })

    expect(splash.show).toHaveBeenCalledExactlyOnceWith(expect.anything(), SPLASH_DARK, reopenCopy)
    expect(reveal).toHaveBeenCalledOnce()
    expect(loaded()).toEqual([BUILD_URL])
  })

  it('still loads the build when the splash itself was interrupted', async () => {
    const { navigator, loaded } = openBuildWindow()
    splash.show.mockRejectedValueOnce(ABORTED)

    await navigator.reopenBehindSplash({
      url: BUILD_URL,
      theme: SPLASH_DARK,
      copy: reopenCopy,
      reveal: () => true
    })

    expect(loaded()).toEqual([BUILD_URL])
  })

  it.each([
    [
      'a workspace switch loaded another page',
      (navigator: ReturnType<typeof navigatorFor>) => navigator.open(TEAM_B_URL),
      [TEAM_B_URL]
    ],
    [
      'the open page was kept for the requested workspace',
      (navigator: ReturnType<typeof navigatorFor>) => navigator.keepCurrentPage(),
      []
    ],
    [
      'the user refreshed',
      (navigator: ReturnType<typeof navigatorFor>) => navigator.refresh(),
      [BUILD_URL]
    ]
  ])(
    'reveals the window but leaves the page alone when %s during the splash',
    async (_newer, request, expectedLoads) => {
      const { navigator, loaded } = openBuildWindow()
      const shown = splashOnScreen()
      const reveal = vi.fn(() => true)

      const reopened = navigator.reopenBehindSplash({
        url: TEAM_A_URL,
        theme: SPLASH_DARK,
        copy: reopenCopy,
        reveal
      })
      void request(navigator)
      shown.resolve()
      await reopened

      expect(reveal).toHaveBeenCalledOnce()
      expect(loaded()).toEqual(expectedLoads)
    }
  )

  it('lets only the latest of two launches reveal and load', async () => {
    const { navigator, loaded } = openBuildWindow()
    const firstSplash = splashOnScreen()
    const secondSplash = splashOnScreen()
    const firstReveal = vi.fn(() => true)
    const secondReveal = vi.fn(() => true)

    const first = navigator.reopenBehindSplash({
      url: TEAM_A_URL,
      theme: SPLASH_DARK,
      copy: reopenCopy,
      reveal: firstReveal
    })
    const second = navigator.reopenBehindSplash({
      url: TEAM_B_URL,
      theme: SPLASH_DARK,
      copy: reopenCopy,
      reveal: secondReveal
    })
    firstSplash.resolve()
    secondSplash.resolve()
    await Promise.all([first, second])

    expect(firstReveal).not.toHaveBeenCalled()
    expect(secondReveal).toHaveBeenCalledOnce()
    expect(loaded()).toEqual([TEAM_B_URL])
  })

  it('leaves the splash up when the build is no longer running', async () => {
    const { navigator, loadURL } = openBuildWindow()

    await navigator.reopenBehindSplash({
      url: BUILD_URL,
      theme: SPLASH_DARK,
      copy: reopenCopy,
      reveal: () => false
    })

    expect(loadURL).not.toHaveBeenCalled()
  })

  it.each([
    [
      'the window closed',
      (window: ReturnType<typeof openBuildWindow>) => {
        window.state.windowDestroyed = true
      }
    ],
    [
      'the build left the window',
      (window: ReturnType<typeof openBuildWindow>) => {
        window.navigator.detach()
      }
    ]
  ])('does nothing more when %s during the splash', async (_reason, interrupt) => {
    const window = openBuildWindow()
    const shown = splashOnScreen()
    const reveal = vi.fn(() => true)

    const reopened = window.navigator.reopenBehindSplash({
      url: BUILD_URL,
      theme: SPLASH_DARK,
      copy: reopenCopy,
      reveal
    })
    interrupt(window)
    shown.resolve()
    await reopened

    expect(reveal).not.toHaveBeenCalled()
    expect(window.loadURL).not.toHaveBeenCalled()
  })
})

describe('showing the restart splash', () => {
  it('takes over from a page that is still loading', async () => {
    const { navigator, fail } = openBuildWindow()

    const opened = navigator.open(BUILD_URL)
    const shown = navigator.showSplash(SPLASH_DARK)
    fail(BUILD_URL, ABORTED)

    await expect(opened).resolves.toBe('superseded')
    await expect(shown).resolves.toBeUndefined()
    expect(splash.show).toHaveBeenCalledExactlyOnceWith(expect.anything(), SPLASH_DARK)
  })

  it('reports a splash that could not be shown', async () => {
    const { navigator } = openBuildWindow()
    splash.show.mockRejectedValueOnce(OFFLINE)

    await expect(navigator.showSplash(SPLASH_DARK)).rejects.toBe(OFFLINE)
  })
})

describe('emptying a window whose build left', () => {
  it('takes over from a page that is still loading and shows a blank page', async () => {
    const { navigator, fail, finish, loaded } = openBuildWindow()

    const opened = navigator.open(BUILD_URL)
    navigator.detach()
    navigator.blank()
    fail(BUILD_URL, ABORTED)
    finish('about:blank')

    await expect(opened).resolves.toBe('superseded')
    expect(loaded()).toEqual([BUILD_URL, 'about:blank'])
  })
})

describe('one navigator per window', () => {
  it('hands every caller the same navigator for a window and a different one for another window', () => {
    const first = openBuildWindow()
    const second = openBuildWindow()

    first.navigator.retryAfterFailure()

    expect(first.navigator.retryPending).toBe(true)
    expect(second.navigator.retryPending).toBe(false)
    expect(first.navigator).not.toBe(second.navigator)
  })
})
