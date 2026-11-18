import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { setAppUpdateState } from './support/devHooks'

const INSTALL_ID = 'inst-restart-when-idle'
const QUIET_MS = 3_000
const TICK_MS = 500

interface DetailField {
  id?: string
  value?: unknown
  footerToggle?: { id: string; value: unknown; editable?: boolean }
}
interface DetailSection {
  tab?: string
  fields?: DetailField[]
}

let ctx: AppContext
let installPath = ''

async function launchWithIdleTimers(settings: Record<string, unknown>): Promise<AppContext> {
  process.env['E2E_IDLE_UPDATE_QUIET_MS'] = String(QUIET_MS)
  process.env['E2E_IDLE_UPDATE_TICK_MS'] = String(TICK_MS)
  try {
    return await launchApp({
      settings: { firstUseCompleted: true, telemetryEnabled: false, ...settings },
      installations: [
        {
          id: INSTALL_ID,
          name: 'Restart When Idle Test',
          installPath,
          sourceId: 'standalone',
          status: 'installed',
          updateChannel: 'stable',
          comfyVersion: { commit: 'a'.repeat(40), baseTag: 'v0.1.0', commitsAhead: 0 },
          releaseTag: 'v0.1.0',
          variant: 'cpu',
          pythonVersion: '3.12'
        }
      ]
    })
  } finally {
    delete process.env['E2E_IDLE_UPDATE_QUIET_MS']
    delete process.env['E2E_IDLE_UPDATE_TICK_MS']
  }
}

async function restartWhenIdleToggle(): Promise<DetailField['footerToggle']> {
  const sections = await ctx.panel.evaluate<DetailSection[]>(
    `window.api.getDetailSections(${JSON.stringify(INSTALL_ID)})`
  )
  return sections.find((s) => s.tab === 'update')?.fields?.find((f) => f.id === 'updateChannel')
    ?.footerToggle
}

async function recordDesktopUpdateFailures(): Promise<void> {
  await ctx.panel.evaluate(
    `(() => {
      window.__desktopUpdateFailures = []
      window.api.onAppUpdateUserActionFailed((e) => window.__desktopUpdateFailures.push(e.message))
      return true
    })()`
  )
}

async function desktopUpdateFailures(): Promise<string[]> {
  return await ctx.panel.evaluate<string[]>('window.__desktopUpdateFailures')
}

test.beforeEach(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfy-restart-when-idle-e2e-'))
  await mkdir(path.join(installPath, 'ComfyUI', '.git'), { recursive: true })
})

test.afterEach(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

test('a git install offers Restart when idle in its Update panel, and the choice is saved @windows @macos @linux', async () => {
  ctx = await launchWithIdleTimers({})
  const toggle = await restartWhenIdleToggle()
  expect(toggle, 'expected the restartWhenIdle footer toggle on the channel field').toMatchObject({
    id: 'restartWhenIdle',
    value: false,
    editable: true
  })

  const result = await ctx.panel.evaluate<{ ok: boolean }>(
    `window.api.updateInstallation(${JSON.stringify(INSTALL_ID)}, { restartWhenIdle: true })`
  )
  expect(result.ok).toBe(true)
  expect((await restartWhenIdleToggle())?.value).toBe(true)
})

test('Desktop settings offer the idle install beside automatic install @windows @macos @linux', async () => {
  ctx = await launchWithIdleTimers({})
  const sections = await ctx.panel.evaluate<DetailSection[]>('window.api.getSettingsSections()')
  const ids = sections.flatMap((s) => (s.fields ?? []).map((f) => f.id))
  expect(ids).toContain('installUpdatesWhenIdle')
  expect(ids.indexOf('installUpdatesWhenIdle')).toBe(ids.indexOf('autoInstallUpdates') + 1)
})

test('a downloaded Desktop update installs once Desktop has been idle @windows @macos @linux', async () => {
  ctx = await launchWithIdleTimers({ installUpdatesWhenIdle: true })
  await recordDesktopUpdateFailures()
  await setAppUpdateState(ctx.app, { kind: 'ready', version: '9.9.9', autoUpdate: true })
  await expect
    .poll(async () => (await desktopUpdateFailures()).length, {
      timeout: QUIET_MS + 10_000,
      message:
        'expected the idle watcher to call installUpdate, which fails in e2e because no real update was downloaded'
    })
    .toBeGreaterThan(0)
})

test('a downloaded Desktop update waits when the idle install is off @windows @macos @linux', async () => {
  ctx = await launchWithIdleTimers({ installUpdatesWhenIdle: false })
  await recordDesktopUpdateFailures()
  await setAppUpdateState(ctx.app, { kind: 'ready', version: '9.9.9', autoUpdate: true })
  await new Promise((r) => setTimeout(r, QUIET_MS + 4 * TICK_MS))
  expect(await desktopUpdateFailures()).toEqual([])
})
