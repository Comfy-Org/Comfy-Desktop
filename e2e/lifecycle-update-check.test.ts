/**
 * Lifecycle E2E: real `check-update` against the live Comfy-Org/ComfyUI
 * git remote.
 *
 * Pre-stages a fake standalone install record pinned to an OLD baseTag,
 * then clicks the real "Check for Update" button in the picker's Update
 * tab and asserts that the release cache picked up the current latest
 * tag from GitHub and the channel cards report an update is available.
 *
 * This is intentionally a network-touching test: it is the only e2e
 * proof that `fetchLatestRelease` (`git ls-remote --tags`) and the
 * release cache → channel-cards pipeline actually wire up against the
 * real upstream. No HTTP mocks, no dev-hook state injection — if
 * github.com or Comfy-Org/ComfyUI changes shape, this test catches it.
 *
 * Cost: one `git ls-remote --tags` to github.com (~tens of KB).
 */

import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { closeTitlePopupIfOpen, titlePopupPage, waitForWebContents } from './support/cdpPages'
import { ageReleaseCache, getIpcInvocations, resetIpcInvocations } from './support/devHooks'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let stagedInstallPath = ''
let stagedInstallPathB = ''

const INSTALL_ID = 'inst-update-check'
const INSTALL_NAME = 'Update Check Test'
// A second install pointed at the same Comfy-Org/ComfyUI repo so the
// stale-cache test can open the picker for an install whose
// ComfyUISettingsContent has never mounted yet — that's the path that
// fires the watcher's `immediate: true` callback against the staled
// shared release cache. (Re-opening the picker for INSTALL_ID after
// the fresh-cache test keeps the same ComfyUISettingsContent instance
// mounted, so the watcher's deps don't re-fire.)
const INSTALL_ID_B = 'inst-update-check-b'
const INSTALL_NAME_B = 'Update Check Test B'
// An intentionally old baseTag so any currently-published stable release
// reads as "newer". v0.1.0 is from June 2024; anything from H2-2024 onward
// will compare strictly greater under semver string ordering on the
// channel card.
const SEEDED_BASE_TAG = 'v0.1.0'
const SEEDED_COMMIT = 'a'.repeat(40)

interface FieldOption {
  value: string
  label: string
  data?: {
    installedVersion: string
    latestVersion: string
    lastChecked: string
    updateAvailable: boolean
  }
}

interface DetailField {
  id?: string
  label?: string
  value?: unknown
  options?: FieldOption[]
}

interface DetailSection {
  tab?: string
  title?: string
  fields?: DetailField[]
  actions?: unknown[]
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  stagedInstallPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-update-check-e2e-'))
  stagedInstallPathB = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-update-check-e2e-b-'))
  // ComfyUI/ existence gates several detail-section branches (e.g. `hasGit`).
  // We don't need a real clone for this test — the check-update path itself
  // only requires it for `enrichCommitsAhead`, which no-ops without a .git
  // dir. The release-cache fetch + channel-card comparison both run.
  await mkdir(path.join(stagedInstallPath, 'ComfyUI'), { recursive: true })
  await mkdir(path.join(stagedInstallPathB, 'ComfyUI'), { recursive: true })

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        installPath: stagedInstallPath,
        sourceId: 'standalone',
        status: 'installed',
        updateChannel: 'stable',
        comfyVersion: { commit: SEEDED_COMMIT, baseTag: SEEDED_BASE_TAG, commitsAhead: 0 },
        // Match the renderer-visible shape so the picker behaves as if this
        // record came out of the real installer.
        releaseTag: SEEDED_BASE_TAG,
        variant: 'cpu',
        pythonVersion: '3.12',
      },
      {
        id: INSTALL_ID_B,
        name: INSTALL_NAME_B,
        installPath: stagedInstallPathB,
        sourceId: 'standalone',
        status: 'installed',
        updateChannel: 'stable',
        comfyVersion: { commit: SEEDED_COMMIT, baseTag: SEEDED_BASE_TAG, commitsAhead: 0 },
        releaseTag: SEEDED_BASE_TAG,
        variant: 'cpu',
        pythonVersion: '3.12',
      },
    ],
  })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (stagedInstallPath) await rm(stagedInstallPath, { recursive: true, force: true })
  if (stagedInstallPathB) await rm(stagedInstallPathB, { recursive: true, force: true })
})

/** Read the stable/latest channel cards back via getDetailSections — the
 *  same (read-only) path the renderer uses for the Update tab. */
async function getChannelField(installationId: string): Promise<DetailField> {
  const sections = await ctx.panel.evaluate<DetailSection[]>(
    `window.api.getDetailSections(${JSON.stringify(installationId)})`,
  )
  const updateSection = sections.find((s) => s.tab === 'update')
  expect(updateSection, 'no update section in detail sections').toBeDefined()
  const channelField = updateSection!.fields!.find((f) => f.id === 'updateChannel')
  expect(channelField?.options, 'update channel field missing options').toBeDefined()
  return channelField!
}

test('check-update hits the real Comfy-Org/ComfyUI remote and finds a newer release @lifecycle', async () => {
  // Open the picker on the Update tab and click the real Check for Update
  // button. (Opening the Update tab with a never-checked cache also fires
  // the auto-refresh watcher — that's the production path too; the manual
  // click on top of it must still succeed.)
  await openPickerOnUpdateTab(INSTALL_ID)
  const popup = titlePopupPage(ctx.app)

  const checkButton = byTestId(TID.updateActionButton('check-update'))
  await popup.waitForVisible(checkButton, { timeout: 15_000 })
  const waitForCheckButtonEnabled = (message: string): Promise<void> =>
    popup.waitFor(
      () => popup.evaluate<boolean>(
        `(() => { const el = document.querySelector('${checkButton}'); return !!el && !el.disabled })()`,
      ),
      { timeout: 30_000, message },
    )
  // The auto-refresh fired on tab open may still be running (button
  // disabled + spinner). Wait for it to settle so the click lands.
  await waitForCheckButtonEnabled('check-update button never became enabled')
  // Drop the auto-refresh's recorded dispatch so the polls below verify
  // the MANUAL check itself — otherwise the channel-card assertion could
  // be satisfied by data the auto-refresh already landed, silently
  // skipping the button-driven path this test exists to prove.
  await resetIpcInvocations(ctx.app, 'run-action')
  expect(await popup.click(checkButton)).toBe(true)

  // The click must dispatch its own check-update run-action…
  await expect
    .poll(async () => countAutoCheckUpdateCalls(
      await getIpcInvocations(ctx.app, 'run-action'),
      INSTALL_ID,
    ), { timeout: 10_000, intervals: [200, 500] })
    .toBeGreaterThanOrEqual(1)
  // …and that manual check must finish (the button re-enables when its
  // operation drains) before the popup can be safely closed below.
  await waitForCheckButtonEnabled('check-update button never re-enabled after the manual check')

  // The check runs a real `git ls-remote` (~hundreds of ms). Poll the
  // channel cards until the remote's data lands.
  await expect
    .poll(async () => {
      const channelField = await getChannelField(INSTALL_ID)
      const stableCard = channelField.options!.find((o) => o.value === 'stable')
      return stableCard?.data?.latestVersion ?? ''
    }, { timeout: 30_000, intervals: [250, 500, 1_000] })
    // The latest stable tag advertised by the remote should look like a real
    // semver-ish ComfyUI tag (e.g. v0.3.59). Don't pin a specific value;
    // the upstream ships releases continuously.
    .toMatch(/v\d+\.\d+/)

  const channelField = await getChannelField(INSTALL_ID)
  const stableCard = channelField.options!.find((o) => o.value === 'stable')
  // The seeded comfyVersion is at v0.1.0 — anything currently-published is
  // newer, so the channel card should report an update available.
  expect(
    stableCard!.data!.updateAvailable,
    `stable card did not flag update available against seeded baseTag ${SEEDED_BASE_TAG}; got latestVersion=${stableCard!.data!.latestVersion}`,
  ).toBe(true)

  await closeTitlePopupIfOpen(ctx.app)
})

test('cross-channel fetch populates the latest channel card too @lifecycle', async () => {
  // The check-update action prefetches the "other" channel(s) in parallel
  // (Promise.allSettled over `['stable', 'latest']`). The previous test
  // already ran check-update — now verify both cards have data, not just
  // the current channel.
  const sections = await ctx.panel.evaluate<DetailSection[]>(
    `window.api.getDetailSections(${JSON.stringify(INSTALL_ID)})`,
  )
  const updateSection = sections.find((s) => s.tab === 'update')!
  const channelField = updateSection.fields!.find((f) => f.id === 'updateChannel')!
  const latestCard = channelField.options!.find((o) => o.value === 'latest')
  expect(latestCard?.data, 'latest channel card has no data — cross-channel prefetch did not run').toBeDefined()
  // The latest channel uses the master HEAD short SHA as its "tag", not a
  // semver. Just assert it's a non-empty version string with a SHA-ish shape
  // (7+ hex chars somewhere in the rendered version).
  expect(latestCard!.data!.latestVersion).toMatch(/[a-f0-9]{7,}/)
})

// ---------------------------------------------------------------------------
// Auto-refresh of stale channel-cards when the Update tab opens.
//
// The release cache persists to disk forever (no TTL). Before this
// watcher landed, a user who installed in January and opened the
// picker in June would see January's "latest release" until they
// clicked the explicit Check for Update button. The renderer now
// fires `check-update` automatically when the Update tab activates
// AND the currently-selected channel's `data.checkedAt` is older than
// `STALE_CHANNEL_CARD_MS` (15 min) — gated per (install, channel) so
// tab flips don't spam IPCs, and re-deduped main-side by the release
// cache's 10s `MIN_RECHECK_INTERVAL`.
// ---------------------------------------------------------------------------

async function openPickerOnUpdateTab(installationId: string): Promise<void> {
  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(installationId)},
        initialTab: 'update',
      })
      return true
    })()`,
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
}

/** Open the picker on the Settings tab (navigation staging), then activate
 *  the Update tab by clicking its real tab button — the actual user gesture
 *  the auto-refresh watcher keys on. */
async function clickToUpdateTab(installationId: string): Promise<void> {
  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(installationId)},
        initialTab: 'settings',
      })
      return true
    })()`,
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  const updateTab = byTestId(TID.settingsTab('update'))
  await popup.waitForVisible(updateTab, { timeout: 15_000 })
  expect(await popup.click(updateTab)).toBe(true)
}

function countAutoCheckUpdateCalls(calls: unknown[], installationId: string): number {
  return (calls as { installationId?: string; actionId?: string }[])
    .filter((c) => c.installationId === installationId && c.actionId === 'check-update')
    .length
}

test('Update tab does NOT auto-refresh when the channel data is fresh @lifecycle', async () => {
  // The previous tests just ran check-update — both cache entries are
  // seconds old, well inside the 15min freshness window. Clicking onto
  // the Update tab must NOT fire an extra check-update IPC.
  await resetIpcInvocations(ctx.app, 'run-action')

  await clickToUpdateTab(INSTALL_ID)

  // Give the renderer a beat to mount + run the watcher. 1.5s is well
  // past the watcher's synchronous fire path; if it were going to fire,
  // it would have done so by now.
  await new Promise((r) => setTimeout(r, 1500))

  const checkUpdates = countAutoCheckUpdateCalls(
    await getIpcInvocations(ctx.app, 'run-action'),
    INSTALL_ID,
  )
  expect(
    checkUpdates,
    `auto-refresh fired ${checkUpdates}x against fresh cache — expected 0 (dedupe broken)`,
  ).toBe(0)

  await closeTitlePopupIfOpen(ctx.app)
})

test('Update tab auto-refreshes when channel data is stale @lifecycle', async () => {
  test.setTimeout(120_000)

  // Age every in-memory release-cache entry past the 15min staleness
  // threshold (+ a healthy buffer) via the E2E hook. Mutating the
  // module's private `_entries` map directly is the only way to make
  // staleness visible without restarting the app — `getDetailSections`
  // reads from the same in-memory state, never re-reads release-cache.json.
  const stalenessTs = Date.now() - 30 * 60 * 1000
  await ageReleaseCache(ctx.app, stalenessTs)

  // Sanity-check via INSTALL_ID_B (the install we're about to open the
  // picker for): the sections pipeline now reports the stale timestamp,
  // proving the hook reached the same map `getEffectiveInfo` reads.
  // The release cache is shared per-repo, so install A and B see the
  // same staled entries.
  const staleSections = await ctx.panel.evaluate<DetailSection[]>(
    `window.api.getDetailSections(${JSON.stringify(INSTALL_ID_B)})`,
  )
  const staleUpdateSection = staleSections.find((s) => s.tab === 'update')!
  const staleChannelField = staleUpdateSection.fields!.find((f) => f.id === 'updateChannel')!
  const staleCard = staleChannelField.options!.find((o) => o.value === staleChannelField.value)
  expect(
    (staleCard?.data as { lastCheckedAt?: number } | undefined)?.lastCheckedAt,
    'ageReleaseCache hook did not mutate the in-memory map main reads from',
  ).toBe(stalenessTs)

  await resetIpcInvocations(ctx.app, 'run-action')

  // Open the picker for INSTALL_ID_B and click onto the Update tab — the
  // real user gesture. INSTALL_ID_B's ComfyUISettingsContent has never
  // been mounted before, so the watcher fires against the staled shared
  // cache. (Re-opening for INSTALL_ID would keep the same Vue component
  // instance + stale-relative-to-renderer sections.value, so the watcher's
  // reactive deps wouldn't re-fire.)
  await clickToUpdateTab(INSTALL_ID_B)

  // The watcher fires after sections load + Update tab activates; the
  // IPC then runs the GitHub fetch (~hundreds of ms) before the
  // run-action invocation lands in the hook tap.
  await expect
    .poll(
      async () => countAutoCheckUpdateCalls(
        await getIpcInvocations(ctx.app, 'run-action'),
        INSTALL_ID_B,
      ),
      { timeout: 15_000, intervals: [250, 500, 1_000] },
    )
    .toBeGreaterThanOrEqual(1)

  // After the auto-refresh completes, the selected channel card's
  // `checkedAt` should advance past `stalenessTs` — proves the
  // staleness was actually cleared, not just an IPC fire.
  await expect
    .poll(async () => {
      const sections = await ctx.panel.evaluate<DetailSection[]>(
        `window.api.getDetailSections(${JSON.stringify(INSTALL_ID_B)})`,
      )
      const updateSection = sections.find((s) => s.tab === 'update')!
      const channelField = updateSection.fields!.find((f) => f.id === 'updateChannel')!
      const card = channelField.options!.find((o) => o.value === channelField.value)
      const checkedAt = (card?.data as { lastCheckedAt?: number } | undefined)?.lastCheckedAt
      return typeof checkedAt === 'number' && checkedAt > stalenessTs
    }, { timeout: 15_000, intervals: [250, 500, 1_000] })
    .toBe(true)

  await closeTitlePopupIfOpen(ctx.app)
})
