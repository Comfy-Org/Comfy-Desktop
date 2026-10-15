// @vitest-environment node
import type { ElectronApplication } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  armLaunchSpawnHold,
  returnFirstInstallHostToDashboard,
  seedRunningSession
} from '../../e2e/support/devHooks'

describe('E2E hooks with non-idempotent effects', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    [
      'returnFirstInstallHostToDashboard',
      (app: ElectronApplication) => returnFirstInstallHostToDashboard(app)
    ],
    [
      'seedRunningSession',
      (app: ElectronApplication) =>
        seedRunningSession(app, { installationId: 'test', installationName: 'Test' })
    ],
    ['armLaunchSpawnHold', (app: ElectronApplication) => armLaunchSpawnHold(app)]
  ] as const)(
    'does not replay %s after a completed callback loses its result',
    async (name, action) => {
      const effect = vi.fn(() => 123)
      vi.stubGlobal('__e2e', { [name]: effect })
      const lostResult = new Error('Resulting promise was garbage collected.')
      const app = {
        evaluate: async (fn: (electron: unknown) => unknown, payload: unknown) => {
          await (fn as (electron: unknown, payload: unknown) => unknown)({}, payload)
          throw lostResult
        }
      } as unknown as ElectronApplication
      await expect(action(app)).rejects.toBe(lostResult)
      expect(effect).toHaveBeenCalledTimes(1)
    }
  )
})
