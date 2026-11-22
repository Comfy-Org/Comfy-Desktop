import path from 'path'
import { describe, expect, it } from 'vitest'
import { DEV_APP_BUNDLE_ENV, devCopyLockDir, planDraftLinkStartup } from './draftLinkStartup'

const LINK = 'comfy://open-app?url=https%3A%2F%2Fpr-12.drafts.comfy.org%2F'
const DEV_SERVER = { ELECTRON_RENDERER_URL: 'http://localhost:5173' }

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
      lock: 'app',
      registration: 'scheme',
      linkWithoutDevServer: false
    })
  })

  it.each(['win32', 'linux'] as const)(
    'gives a %s dev copy a per-clone lock and a command registration',
    (platform) => {
      expect(plan({ platform })).toEqual({
        lock: 'dev-copy',
        registration: 'scheme-with-command',
        linkWithoutDevServer: false
      })
    }
  )

  it('registers a macOS dev copy only when it runs from the dev app bundle', () => {
    expect(plan({ platform: 'darwin' }).registration).toBe('none')
    expect(
      plan({ platform: 'darwin', env: { ...DEV_SERVER, [DEV_APP_BUNDLE_ENV]: '/x.app' } })
    ).toEqual({ lock: 'dev-copy', registration: 'scheme', linkWithoutDevServer: false })
  })

  it.each(['win32', 'linux', 'darwin'] as const)(
    'turns links, the lock and registration off for e2e runs on %s',
    (platform) => {
      expect(
        plan({ platform, env: { ...DEV_SERVER, E2E: '1', COMFY_DRAFT_APP_LINKS: '0' } })
      ).toEqual({ lock: 'none', registration: 'none', linkWithoutDevServer: false })
    }
  )

  it('hands links back on Windows when links are turned off', () => {
    expect(plan({ env: { ...DEV_SERVER, COMFY_DRAFT_APP_LINKS: '0' }, startupLink: LINK })).toEqual(
      { lock: 'none', registration: 'remove-own-command', linkWithoutDevServer: false }
    )
  })

  it.each(['linux', 'darwin'] as const)(
    'leaves the registration alone on %s when links are turned off',
    (platform) => {
      expect(
        plan({ platform, env: { ...DEV_SERVER, COMFY_DRAFT_APP_LINKS: '0' }, startupLink: LINK })
      ).toEqual({ lock: 'none', registration: 'none', linkWithoutDevServer: false })
    }
  )

  it('flags a link click that started a dev copy with no dev server', () => {
    expect(plan({ env: {}, startupLink: LINK }).linkWithoutDevServer).toBe(true)
  })

  it('lets a dev copy started by the dev server open a link it was started with', () => {
    expect(plan({ startupLink: LINK }).linkWithoutDevServer).toBe(false)
  })

  it('does not flag a dev copy started with no link and no dev server', () => {
    expect(plan({ env: {} }).linkWithoutDevServer).toBe(false)
  })
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
