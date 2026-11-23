import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isPackaged: true,
  saved: undefined as boolean | undefined,
  savedThrows: false
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged
    }
  }
}))
vi.mock('./appsFlag', () => ({
  isAppsFlagOn: async () => mocks.saved ?? false,
  savedAppsFlag: () => {
    if (mocks.savedThrows) throw new Error('unreadable')
    return mocks.saved
  }
}))

import { appsEnabledAtStart } from './appsConfig'

beforeEach(() => {
  mocks.isPackaged = true
  mocks.saved = undefined
  mocks.savedThrows = false
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('appsEnabledAtStart, for comfy.desktop.session.started', () => {
  it.each([true, false])('is the Apps switch the last session saved: %s', (saved) => {
    mocks.saved = saved

    expect(appsEnabledAtStart()).toBe(saved)
  })

  it('is unknown when no session saved the switch yet', () => {
    expect(appsEnabledAtStart()).toBeUndefined()
  })

  it('is unknown, and does not throw, when the saved switch cannot be read', () => {
    mocks.savedThrows = true

    expect(appsEnabledAtStart()).toBeUndefined()
  })

  it('is on in a development build pointed at an apps site', () => {
    mocks.isPackaged = false
    mocks.saved = false
    vi.stubEnv('COMFY_APPS_URL', 'http://127.0.0.1:5173/apps/')

    expect(appsEnabledAtStart()).toBe(true)
  })

  it('ignores an apps site in a packaged build', () => {
    vi.stubEnv('COMFY_APPS_URL', 'http://127.0.0.1:5173/apps/')
    mocks.saved = false

    expect(appsEnabledAtStart()).toBe(false)
  })
})
