import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  DEV_APP_BUNDLE_ENV,
  DEV_DESKTOP_ENTRY_ENV,
  DEV_SERVER_LOCK_WAIT_MS,
  DEV_SERVER_START_DATA,
  devCopyLockDir,
  isDevServerStart,
  planDraftLinkStartup,
  retryLock
} from './draftLinkStartup'

const LINK = 'comfy://open-app?url=https%3A%2F%2Fpr-12.drafts.comfy.org%2F'
const DEV_SERVER = { ELECTRON_RENDERER_URL: 'http://localhost:5173' }
const ENTRY = 'comfy-desktop-dev-0123456789ab.desktop'

const LINKS_OFF = {
  lock: 'none',
  lockTiming: 'start',
  lockWaitMs: 0,
  registration: 'none',
  desktopEntry: null,
  linkWithoutDevServer: false
}

function plan(overrides: Partial<Parameters<typeof planDraftLinkStartup>[0]> = {}) {
  return planDraftLinkStartup({
    isPackaged: false,
    platform: 'win32',
    env: DEV_SERVER,
    startupLink: null,
    ...overrides
  })
}

describe('planDraftLinkStartup', () => {
  it('keeps the packaged app on its own lock and plain scheme registration', () => {
    expect(plan({ isPackaged: true, env: {}, startupLink: LINK })).toEqual({
      ...LINKS_OFF,
      lock: 'app',
      registration: 'scheme'
    })
  })

  it('gives a Windows dev copy a per-clone lock and a command registration', () => {
    expect(plan()).toEqual({
      lock: 'dev-copy',
      lockTiming: 'ready',
      lockWaitMs: DEV_SERVER_LOCK_WAIT_MS,
      registration: 'scheme-with-command',
      desktopEntry: null,
      linkWithoutDevServer: false
    })
  })

  it('registers a Linux dev copy through the desktop entry the dev script wrote', () => {
    expect(
      plan({ platform: 'linux', env: { ...DEV_SERVER, [DEV_DESKTOP_ENTRY_ENV]: ENTRY } })
    ).toEqual({
      lock: 'dev-copy',
      lockTiming: 'ready',
      lockWaitMs: DEV_SERVER_LOCK_WAIT_MS,
      registration: 'desktop-entry',
      desktopEntry: ENTRY,
      linkWithoutDevServer: false
    })
  })

  it('does not register a Linux dev copy that has no desktop entry', () => {
    expect(plan({ platform: 'linux' })).toMatchObject({
      lock: 'dev-copy',
      registration: 'none',
      desktopEntry: null
    })
  })

  it('registers a macOS dev copy only when it runs from the dev app bundle', () => {
    expect(plan({ platform: 'darwin' }).registration).toBe('none')
    expect(
      plan({ platform: 'darwin', env: { ...DEV_SERVER, [DEV_APP_BUNDLE_ENV]: '/x.app' } })
    ).toMatchObject({ lock: 'dev-copy', registration: 'scheme', linkWithoutDevServer: false })
  })

  it.each(['win32', 'linux', 'darwin'] as const)(
    'turns links, the lock and registration off for e2e runs on %s',
    (platform) => {
      expect(
        plan({ platform, env: { ...DEV_SERVER, E2E: '1', COMFY_DRAFT_APP_LINKS: '0' } })
      ).toEqual(LINKS_OFF)
    }
  )

  it('hands links back on Windows when links are turned off', () => {
    expect(plan({ env: { ...DEV_SERVER, COMFY_DRAFT_APP_LINKS: '0' }, startupLink: LINK })).toEqual(
      { ...LINKS_OFF, registration: 'remove-own-command' }
    )
  })

  it.each(['linux', 'darwin'] as const)(
    'leaves registration to the dev script on %s when links are turned off',
    (platform) => {
      expect(
        plan({ platform, env: { ...DEV_SERVER, COMFY_DRAFT_APP_LINKS: '0' }, startupLink: LINK })
      ).toEqual(LINKS_OFF)
    }
  )

  it('lets a copy started by the dev server take the lock after ready, waiting for a restarting copy', () => {
    expect(plan()).toMatchObject({ lockTiming: 'ready', lockWaitMs: DEV_SERVER_LOCK_WAIT_MS })
  })

  it('makes a copy started by a link click try the lock once so its link is handed over', () => {
    expect(plan({ env: {}, startupLink: LINK })).toMatchObject({
      lock: 'dev-copy',
      lockTiming: 'start',
      lockWaitMs: 0,
      linkWithoutDevServer: true
    })
  })

  it('lets a dev copy started by the dev server open a link it was started with', () => {
    expect(plan({ startupLink: LINK }).linkWithoutDevServer).toBe(false)
  })

  it('does not flag a dev copy started with no link and no dev server', () => {
    expect(plan({ env: {} }).linkWithoutDevServer).toBe(false)
  })
})

describe('retryLock', () => {
  function run(tryLock: (now: number) => boolean, waitMs = 5000) {
    let time = 0
    const results: boolean[] = []
    const pending: Array<() => void> = []
    let tries = 0
    retryLock({
      tryLock: () => (tries++, tryLock(time)),
      waitMs,
      intervalMs: 100,
      now: () => time,
      schedule: (attempt, ms) => {
        pending.push(() => {
          time += ms
          attempt()
        })
      },
      onDone: (held) => results.push(held)
    })
    for (let next = pending.shift(); next; next = pending.shift()) next()
    return { results, tries, time }
  }

  it('takes a free lock on the first try without waiting', () => {
    expect(run(() => true)).toEqual({ results: [true], tries: 1, time: 0 })
  })

  it('takes the lock once the previous copy lets go within the wait', () => {
    expect(run((now) => now >= 1000)).toEqual({ results: [true], tries: 11, time: 1000 })
  })

  it('gives up after the wait when another copy keeps the lock', () => {
    expect(run(() => false)).toEqual({ results: [false], tries: 51, time: 5000 })
  })

  it('tries once when there is no wait', () => {
    expect(run(() => false, 0)).toEqual({ results: [false], tries: 1, time: 0 })
  })
})

describe('isDevServerStart', () => {
  it('recognises the data a dev server start sends with its lock request', () => {
    expect(isDevServerStart(DEV_SERVER_START_DATA)).toBe(true)
  })

  it.each([undefined, null, {}, { devServerStart: 'true' }, 'devServerStart'])(
    'treats %o as a real second launch',
    (data) => {
      expect(isDevServerStart(data)).toBe(false)
    }
  )
})

describe('devCopyLockDir', () => {
  const userData = path.join('/home', 'me', '.config', 'comfyui-desktop-2')

  it('keeps the lock inside the dev copy data folder', () => {
    const dir = devCopyLockDir(userData, '/src/Comfy-Desktop', 'linux')
    expect(path.dirname(path.dirname(dir))).toBe(userData)
  })

  it('gives each clone its own lock', () => {
    expect(devCopyLockDir(userData, '/src/a', 'linux')).not.toBe(
      devCopyLockDir(userData, '/src/b', 'linux')
    )
  })

  it('gives one clone the same lock however Windows cased its path', () => {
    expect(devCopyLockDir(userData, 'C:\\src\\Comfy-Desktop', 'win32')).toBe(
      devCopyLockDir(userData, 'c:\\SRC\\comfy-desktop', 'win32')
    )
  })
})
