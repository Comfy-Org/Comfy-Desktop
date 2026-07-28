/**
 * Lifecycle E2E: New Install (recommended standalone variant for the host
 * GPU, latest stable release) → ComfyUI auto-launches via brand chrome →
 * dashboard return → relaunch → stop.
 *
 * Downloads ~500 MB of standalone payload. Tagged @lifecycle and runs under
 * the dedicated Playwright project (10-minute per-test timeout).
 *
 * Run:
 *   pnpm run build && pnpm run test:e2e:windows -- --project=lifecycle
 *
 * Requirements: network access, ~2 GB free disk.
 *
 * Redesign notes (vs. the pre-2.0-Beta lifecycle test):
 * - The new-install takeover is a single Configure screen wrapped in
 *   `BrandTakeoverLayout` (root: `.brand-takeover-root`). No multi-step
 *   wizard, no Next button.
 * - Standalone is pre-selected on open. `loadFieldOptions('release')`
 *   picks the recommended option ("Latest Stable") and recursively
 *   loads `loadFieldOptions('variant')` which picks its own recommended
 *   option (CPU on a no-GPU CI runner, NVIDIA on an NVIDIA box, etc.).
 *   So by the time `saveDisabled` flips false, the form is fully
 *   pre-filled — no explicit release / variant picking needed.
 * - The primary CTA is `.brand-primary.config-continue` labelled
 *   "Continue" (formerly `button.primary` "Add Install").
 * - `handleSave` emits `show-progress` with `autoLaunchOnFinish: true`,
 *   so the install op chains directly into a launch op under the same
 *   brand-takeover chrome. There is no intermediate "Done" button and
 *   no need to click the chooser tile to launch — the chooser host
 *   transforms in place into the install host (issue #449 path).
 */

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import {
  clickInstallTile,
  expectChooserVisible,
  expectTakeoverOpen,
  openManageViaDashboard,
  openPickerViaTitlePill,
} from './support/chooserHelpers'
import {
  armLaunchSpawnHold,
  ensureInstallPanelView,
  getIpcInvocations,
  getRunningSessionSnapshot,
  hasActiveLaunch,
  hasActiveOperation,
  isInstallLaunching,
  isLaunchSpawnHeld,
  releaseLaunchSpawnHold,
  resetIpcInvocations,
} from './support/devHooks'
import {
  closeTitlePopupIfOpen,
  isPopupVisible,
  titlePopupPage,
  waitForWebContents,
  type WebContentsPage,
} from './support/cdpPages'
import { evalWithRetry } from './support/evalRetry'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext

/** Wait until the config takeover's Continue CTA
 *  (`.brand-primary.config-continue`, bound to `:disabled="!canContinue"`)
 *  is enabled — i.e. the form is fully filled and settled. */
async function waitForConfigContinueEnabled(message: string): Promise<void> {
  await ctx.panel.waitFor(
    async () => evalWithRetry(() => ctx.app.evaluate(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('panel.html'))
      if (!wc) return false
      return wc.executeJavaScript(`(() => {
        const btn = document.querySelector('.brand-primary.config-continue')
        return !!btn && !btn.disabled
      })()`) as Promise<boolean>
    })),
    { timeout: 60_000, message },
  )
}

/** True after `beforeAll` if an install record was hydrated from disk.
 *  Setup tests (consent / first-use / completes-install / post-install
 *  verification) skip themselves when this is set so a subset of the
 *  suite can run against a reused profile.
 *
 *  SECTIONS: every test carries a `@sec-<name>` tag grouping it with the
 *  tests it shares state with. Each section is self-sufficient when run
 *  as `@sec-setup|@sec-meta|@sec-<name>`: on a fresh profile the setup
 *  spine builds the install first; on a hydrated profile the spine
 *  self-skips and only the section runs. `@sec-meta` (captures install
 *  id/path + the torch baseline) is cheap and must always be included.
 *  The `test:e2e:lifecycle:<section>` npm scripts encode these patterns.
 *
 *    setup        first-use consent, install wizard, auto-launch checks
 *    meta         install id/path + torch-family baseline capture
 *    update       stop -> update-comfyui -> relaunch (needs update work
 *                 to exist; may no-op on an already-updated profile)
 *    pytorch      switch to another compatible stack and back
 *    crosschannel stable -> latest channel switch (one-shot per profile:
 *                 requires updateChannel=stable and leaves it on latest)
 *    snapshot     snapshot capture + picker-driven restore
 *    manager      per-install Manager security level / network mode
 *    picker       picker Restart / Stop / Relaunch CTAs
 *    bootwindow   restart-during-boot regressions (run as a group: the
 *                 fresh-chooser test consumes the siblings' --port edit)
 *    copy         picker + kebab copies, untrack, and their cleanup
 *    delete       stops comfy and DELETES the install (consumes a reused
 *                 profile - reset the reuse dir before running setup again)
 *
 *  Usage:
 *    # One section on a throwaway profile (builds the real install first):
 *    pnpm run test:e2e:lifecycle:bootwindow
 *
 *    # Fast repeated section runs: persist the profile across runs.
 *    $env:LIFECYCLE_REUSE_DIR = "$env:TEMP\comfyui-lifecycle-reuse"
 *    pnpm run test:e2e:lifecycle:install     # first run builds the install
 *    pnpm run test:e2e:lifecycle:bootwindow  # setup skips, section only
 *    pnpm run test:e2e:lifecycle:manager     # ditto
 *    Remove-Item Env:\LIFECYCLE_REUSE_DIR
 */
let HYDRATED = false

/** Install variant the chain drives through the REAL install wizard,
 *  from `LIFECYCLE_VARIANT`:
 *  - 'cpu'     - deterministic CPU torch build (default on Windows).
 *  - 'nvidia'  - CUDA torch build; refuses to run without a working
 *                NVIDIA driver so it can never pass vacuously.
 *  - 'amd'     - ROCm torch build; refuses to run without an AMD GPU
 *                so it can never pass vacuously.
 *  - 'default' - no explicit pick; trust the form's recommended
 *                variant (macOS only publishes `mac-mps`, Linux
 *                publishes no `linux-cpu`).
 */
function resolveLifecycleVariant(): 'cpu' | 'nvidia' | 'amd' | 'default' {
  const raw = (process.env['LIFECYCLE_VARIANT'] ?? '').toLowerCase()
  if (raw === '') return process.platform === 'win32' ? 'cpu' : 'default'
  if (raw === 'nvidia' || raw === 'amd') {
    if (process.platform === 'darwin') {
      throw new Error(`LIFECYCLE_VARIANT=${raw} is not supported on macOS (only mac-mps is published)`)
    }
    return raw
  }
  if (raw === 'cpu') {
    if (process.platform !== 'win32') {
      throw new Error('LIFECYCLE_VARIANT=cpu is only published for Windows (no linux-cpu / mac-cpu variant)')
    }
    return 'cpu'
  }
  throw new Error(`Unsupported LIFECYCLE_VARIANT "${process.env['LIFECYCLE_VARIANT']}" - use "cpu", "nvidia" or "amd"`)
}
const LIFECYCLE_VARIANT = resolveLifecycleVariant()
/** GPU variants share heavyweight timeouts: their torch stacks are
 *  multi-GB downloads, unlike the CPU build. */
const GPU_VARIANT = LIFECYCLE_VARIANT === 'nvidia' || LIFECYCLE_VARIANT === 'amd'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  // Fail fast on machines that cannot honor an NVIDIA run: without a
  // working driver the CUDA install would only fail (or worse, pass
  // vacuously) after the multi-GB torch download.
  if (LIFECYCLE_VARIANT === 'nvidia') {
    try {
      execFileSync('nvidia-smi', ['-L'], { encoding: 'utf-8', windowsHide: true, timeout: 30_000 })
    } catch {
      throw new Error('LIFECYCLE_VARIANT=nvidia requires a working NVIDIA driver (`nvidia-smi -L` failed); refusing to run the CUDA lifecycle on this machine')
    }
  }
  // Same fail-fast for AMD: without an AMD GPU the ROCm install would
  // only fail (or pass vacuously) after the multi-GB download.
  if (LIFECYCLE_VARIANT === 'amd') {
    let adapters = ''
    try {
      adapters = process.platform === 'win32'
        ? execFileSync('powershell.exe',
            ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
            { encoding: 'utf-8', windowsHide: true, timeout: 30_000 })
        : execFileSync('sh', ['-c', 'lspci -d ::0300 -d ::0302 2>/dev/null || lspci 2>/dev/null'],
            { encoding: 'utf-8', timeout: 30_000 })
    } catch { /* fall through to the adapter check below */ }
    if (!/\b(AMD|Radeon)\b/i.test(adapters)) {
      throw new Error('LIFECYCLE_VARIANT=amd requires an AMD GPU (no AMD/Radeon display adapter found); refusing to run the ROCm lifecycle on this machine')
    }
  }

  if (!process.env['GITHUB_TOKEN']) {
    for (let depth = 2; depth <= 8; depth++) {
      const segments = Array(depth).fill('..')
      const p = resolve(__dirname, ...segments, 'githubtoken.txt')
      try {
        process.env['GITHUB_TOKEN'] = readFileSync(p, 'utf-8').trim()
        break
      } catch { /* try next depth */ }
    }
  }
  // True cold start: no `firstUseCompleted` seed, so the host opens on
  // the first-use takeover. The first test below drives through consent
  // + pick-local, which chains directly into the new-install takeover
  // (Tier 3 → Tier 3 silent swap) — the same surface the user reaches
  // on the no-existing-installs cold-start path.
  //
  // When `LIFECYCLE_REUSE_DIR` is set against a directory that already
  // contains a completed install, we rehydrate the shared
  // `let _foo = ''` state below from disk so individually-greped tests
  // behave the same as if they had followed the full chain. On a
  // first-run/empty profile the install tests run normally and produce
  // the on-disk state the next greped run consumes.
  ctx = await launchApp()

  if (process.env['LIFECYCLE_REUSE_DIR']) {
    try {
      await ctx.panel.waitForVisible('.chooser-view', { timeout: 10_000 })
    } catch { /* fresh boot may still be on first-use takeover */ }
    const installs = await ctx.panel.evaluate<InstallationLite[]>(`window.api.getInstallations()`)
      .catch(() => [] as InstallationLite[])
    // Filter out the Cloud install record (no `installPath`) that's
    // seeded on first chooser mount — only a local standalone is a
    // valid hydration target.
    const localInstall = installs.find((i) => typeof i.installPath === 'string' && i.installPath.length > 0)
    if (localInstall) {
      _updateInstallId = localInstall.id
      _updateInstallPath = localInstall.installPath
      _comfyUIDir = path.join(_updateInstallPath, 'ComfyUI')
      try {
        _installedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: _comfyUIDir, encoding: 'utf-8', windowsHide: true,
        }).trim()
      } catch { /* partial hydration — git dir may not exist on a half-built profile */ }
      try {
        _installedTorchSignature = queryTorchSignature()
      } catch { /* partial hydration - venv may not exist on a half-built profile */ }
      // A reused profile must match the requested variant - rerunning
      // the CUDA suite against a CPU profile (or vice versa) would
      // assert against the wrong torch build.
      if (_installedTorchSignature && LIFECYCLE_VARIANT !== 'default') {
        const buildVariant = _installedTorchSignature.hip !== null
          ? 'amd' : _installedTorchSignature.cuda !== null ? 'nvidia' : 'cpu'
        if (LIFECYCLE_VARIANT !== buildVariant) {
          throw new Error(
            `LIFECYCLE_VARIANT=${LIFECYCLE_VARIANT} but the reused profile carries a ${buildVariant} torch build`
            + ' - point LIFECYCLE_REUSE_DIR at a matching profile or unset it',
          )
        }
      }
      try {
        const list = await ctx.panel.evaluate<SnapshotListLite>(
          `window.api.getSnapshots(${JSON.stringify(_updateInstallId)})`,
        )
        const target = list.snapshots.find((s) => s.label === 'lifecycle-restore-target')
        if (target) {
          _restoreSnapshotFilename = target.filename
          const snapPath = path.join(_updateInstallPath, '.launcher', 'snapshots', target.filename)
          const snap = JSON.parse(readFileSync(snapPath, 'utf-8')) as {
            comfyui?: { commit?: string | null }
          }
          if (snap.comfyui?.commit) _snapshotHeadAtCapture = snap.comfyui.commit
        }
      } catch { /* snapshot not yet captured on this profile */ }
      HYDRATED = true
      console.log(`[lifecycle] hydrated from reused profile: installId=${_updateInstallId} commit=${_installedCommit || '(none)'} restoreSnapshot=${_restoreSnapshotFilename || '(none)'}`)

      // The picker-driven IN_PLACE_RELAUNCH tests (update / restore /
      // restart) and the pin-bottom Restart / Copy tests all assume
      // comfy is running before they fire — that's the state the full
      // chain reaches via test 11 ("re-launch ComfyUI after update").
      // Launch the install here so a greped re-run lands in the same
      // running-comfy state instead of skipping the relaunch leg.
      try {
        await clickInstallTile(ctx.panel, 'ComfyUI')
        await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000, 2_000] }).toBe(true)
        // chooser-pick attach destroys the panel webContents without
        // remounting (production lazily mounts on the next Settings
        // click / comfy-lifecycle body) — picker-driven tests need
        // `ctx.panel.evaluate` reachable, so do the lazy mount once
        // here. Mirrors the same dance test 12 does after `clickInstallTile`.
        await ensureInstallPanelView(ctx.app, _updateInstallId)
        await waitForWebContents(ctx.app, 'panel.html')
        console.log('[lifecycle] auto-launched reused install + remounted install-backed panel view')
      } catch (err) {
        console.log(`[lifecycle] auto-launch failed (tests that require running comfy will fail): ${(err as Error).message}`)
      }
    } else {
      console.log('[lifecycle] LIFECYCLE_REUSE_DIR set but no install found — running fresh setup tests to populate the profile')
    }
  }
})

/** Install trees created by THIS run (fresh install + real-UI copies).
 *  A green run removes all of them through the real UI (the copy-cleanup
 *  and final Delete tests), so the afterAll sweep below is a no-op; it
 *  exists so aborted/failed runs don't orphan multi-hundred-MB trees under
 *  the installs root, which lives OUTSIDE the harness profile dir and is
 *  therefore untouched by harness teardown. Hydrated (reused) installs are
 *  never registered. */
const _runCreatedInstallPaths = new Set<string>()

/** The isolated profile's installations.json, or null on macOS where the
 *  harness cannot isolate userData (Application Support ignores HOME) and
 *  the store may list real installs that must never be swept. Mirrors
 *  `dataDir()` in src/main/lib/paths.ts under the harness's env overrides
 *  (APPDATA / XDG_DATA_HOME redirected into homeDir). */
function isolatedInstallationsStorePath(homeDir: string): string | null {
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Roaming', 'comfyui-desktop-2', 'installations.json')
  }
  if (process.platform === 'linux') {
    return path.join(homeDir, '.local', 'share', 'comfyui-desktop-2', 'installations.json')
  }
  return null
}

test.afterAll(async () => {
  // ctx is unassigned when beforeAll throws before launching the app
  // (e.g. the nvidia-smi preflight) - don't bury that error under a
  // TypeError from teardown.
  if (typeof ctx === 'undefined') return

  // Before teardown deletes the isolated profile, collect every local
  // install it recorded: a fresh profile can only contain records this
  // run created, so this also catches installs orphaned by an abort
  // before any path-capturing test ran (e.g. mid-download).
  if (!process.env['LIFECYCLE_REUSE_DIR']) {
    const storePath = isolatedInstallationsStorePath(ctx.homeDir)
    if (storePath) {
      try {
        const records = JSON.parse(readFileSync(storePath, 'utf-8')) as { installPath?: unknown }[]
        for (const r of records) {
          if (typeof r.installPath === 'string' && path.isAbsolute(r.installPath)) {
            _runCreatedInstallPaths.add(r.installPath)
          }
        }
      } catch { /* store never materialized - run aborted before any install */ }
    }
  }

  await ctx.cleanup()

  // Best-effort sweep, after the app is closed so nothing holds file
  // locks. `force` tolerates trees the suite already deleted via the
  // real UI. LIFECYCLE_REUSE_DIR preserves everything for greped
  // re-runs, mirroring the harness's profile preservation.
  if (!process.env['LIFECYCLE_REUSE_DIR']) {
    if (_runCreatedInstallPaths.size > 0) {
      console.log(`[lifecycle] afterAll sweep over ${_runCreatedInstallPaths.size} run-created install path(s): ${[..._runCreatedInstallPaths].join(', ')}`)
    }
    for (const p of _runCreatedInstallPaths) {
      try {
        rmSync(p, { recursive: true, force: true })
      } catch (err) {
        console.log(`[lifecycle] afterAll sweep failed to remove ${p}: ${(err as Error).message}`)
      }
    }
  }
})

/** True iff a webContents with a localhost URL exists and is loaded. */
async function comfyFrontendIsLoaded(): Promise<boolean> {
  return evalWithRetry(() => ctx.app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some((wc) =>
      /^http:\/\/(127\.0\.0\.1|localhost):/.test(wc.getURL()) && !wc.isLoading(),
    ),
  ))
}

// ---------------------------------------------------------------------------
// First-use takeover → New Install takeover
// ---------------------------------------------------------------------------

test('cold start lands on first-use start screen @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: first-use already completed on the persisted profile')
  // The first-use takeover gates the chooser body until consent +
  // cloud/local pick + Continue are completed on the merged start
  // screen (commit 5619823 clubbed the legacy two-step flow into one).
  await ctx.panel.waitForVisible('.start-hero', { timeout: 15_000 })
  await ctx.panel.waitForVisible('[data-testid="first-use-pick-cloud"]')
  await ctx.panel.waitForVisible('[data-testid="first-use-pick-local"]')
  await ctx.panel.waitForVisible('[data-testid="first-use-continue"]')
})

test('accept ToS + pick local (non-express) opens New Install takeover with form pre-filled @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: first-use already completed on the persisted profile')

  // Pick Local — reveals the Express-Install modifier. We want the
  // normal (non-express) local path so the New Install Tier 3 takeover
  // opens; the express path silently routes through standalone install
  // and is covered by FirstUseTakeover.test.ts unit specs.
  expect(await ctx.panel.click('[data-testid="first-use-pick-local"]')).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="first-use-express-install"]', { timeout: 5_000 })

  // Express defaults to UNCHECKED on Local pick (#1020: users land on
  // Configure before any files are written). Assert the default first
  // (read-only), then toggle the real checkbox control on and back off
  // so the non-express New Install takeover path is taken.
  const expressCheckbox = '[data-testid="first-use-express-install"] input[type="checkbox"]'
  expect(
    await ctx.panel.evaluate<boolean>(
      `document.querySelector(${JSON.stringify(expressCheckbox)})?.checked === false`,
    ),
    'Express Install should default to unchecked on Local pick',
  ).toBe(true)
  expect(await ctx.panel.click(expressCheckbox)).toBe(true)
  expect(
    await ctx.panel.evaluate<boolean>(
      `document.querySelector(${JSON.stringify(expressCheckbox)})?.checked === true`,
    ),
    'Express Install checkbox did not check',
  ).toBe(true)
  expect(await ctx.panel.click(expressCheckbox)).toBe(true)
  expect(
    await ctx.panel.evaluate<boolean>(
      `document.querySelector(${JSON.stringify(expressCheckbox)})?.checked === false`,
    ),
    'Express Install checkbox did not uncheck',
  ).toBe(true)

  // Tick the required ToS checkbox (telemetry stays at its default
  // opt-in; the test settings already disable telemetry network egress
  // separately, so the actual value doesn't matter here).
  expect(await ctx.panel.click('[data-testid="first-use-consent-tos"]')).toBe(true)
  await ctx.panel.waitFor(
    async () => ctx.panel.evaluate<boolean>(
      `!document.querySelector('[data-testid="first-use-continue"]').disabled`,
    ),
    { timeout: 5_000, message: 'Continue never became enabled after ticking ToS' },
  )

  // Continue with Local + non-express + no legacy desktop install:
  // emits `chain-local`, which the host swaps for the New Install
  // Tier 3 takeover (silent Tier 3 → Tier 3 swap inside `useOverlay`).
  expect(await ctx.panel.click('[data-testid="first-use-continue"]')).toBe(true)
  await expectTakeoverOpen(ctx.panel)

  // Standalone is pre-selected on open. The release + variant fields
  // live inside the Advanced disclosure but are populated eagerly via
  // `loadFieldOptions('release')` → recursive `loadFieldOptions('variant')`.
  // `.brand-primary.config-continue` is bound to `:disabled="!canContinue"`,
  // so once it goes enabled the form is fully pre-filled (release picked,
  // variant picked, no path issues).
  await waitForConfigContinueEnabled('Continue button never became enabled (form did not pre-fill)')

  // Open Advanced so the release BaseSelect + variant rows are
  // interactive. The body is CSS-hidden when collapsed; the BaseSelect
  // trigger does not register clicks while hidden.
  expect(await ctx.panel.click('.config-advanced__summary')).toBe(true)
  await ctx.panel.waitForSelector('#source-fields button[role="combobox"]', {
    timeout: 5_000,
  })

  // The Release select offers only the two channels (Stable / Latest on
  // GitHub) and pre-fills the recommended Stable. Keep it, and instead
  // pin the ComfyUI Version select to the SECOND-newest stable tag so
  // post-install the Stable channel naturally reports "Update available"
  // for the update tests further down (no `git reset --hard` workaround).
  // One release back keeps the requirements delta small; the tag list is
  // sorted newest-first with the newest marked recommended.
  // The select stays disabled until its stable-tag options resolve.
  await ctx.panel.waitForSelector(
    '#source-fields button[role="combobox"][aria-label="ComfyUI Version"]:not([disabled])',
    { timeout: 60_000 },
  )
  expect(
    await ctx.panel.click('#source-fields button[role="combobox"][aria-label="ComfyUI Version"]'),
  ).toBe(true)
  await ctx.panel.waitForVisible('[role="listbox"] [role="option"]', { timeout: 10_000 })
  expect(
    await ctx.panel.clickNth('[role="listbox"] [role="option"]', 1),
    'failed to click the second-newest ComfyUI Version option in BaseSelect listbox',
  ).toBe(true)

  // Picking a version re-fires `loadFieldOptions('variant')`,
  // which flips `saveDisabled` true until the variant options resolve
  // and the recommended variant is re-picked. Wait for Continue to
  // come back enabled before moving on.
  await waitForConfigContinueEnabled('Continue button never re-enabled after picking the older stable tag')

  // Drive the variant row to the requested LIFECYCLE_VARIANT. CPU is
  // the Windows default so the chain stays deterministic across
  // runners (NVIDIA hosts would otherwise download a multi-GB GPU
  // payload); 'nvidia' selects the CUDA build explicitly. macOS only
  // publishes `mac-mps` and Linux publishes no `linux-cpu` variant,
  // so with no explicit variant those platforms trust the recommended
  // pick the form already made.
  if (LIFECYCLE_VARIANT !== 'default') {
    const rowLabel = LIFECYCLE_VARIANT === 'nvidia' ? 'NVIDIA' : LIFECYCLE_VARIANT === 'amd' ? 'AMD' : 'CPU'
    await ctx.panel.waitForSelector('.brand-variant-row', { timeout: 5_000 })
    expect(
      await ctx.panel.clickByText('.brand-variant-row', rowLabel),
      `${rowLabel} variant row clicked`,
    ).toBe(true)
    // Confirm the requested row is the selected one before continuing —
    // otherwise a label-substring miss (e.g. an i18n change) would
    // silently fall back to the recommended variant.
    await ctx.panel.waitFor(
      async () => ctx.panel.evaluate<boolean>(
        `(() => {
          const sel = document.querySelector('.brand-variant-row--selected .brand-variant-row__label')
          return !!sel && new RegExp(${JSON.stringify(rowLabel)}, 'i').test(sel.textContent || '')
        })()`,
      ),
      { timeout: 5_000, message: `${rowLabel} variant did not become the selected variant row` },
    )
  }
})

test('completes install (auto-launches via brand chrome) @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: install already on disk on the persisted profile')
  // The install poll below allows 480s; the project default test timeout is
  // 180s, which real GPU installs exceed (observed: AMD fresh install at 94%
  // "Loading custom nodes" killed at 180s, clean retry took 2.8m).
  test.setTimeout(600_000)
  // The CPU-variant pick at the end of the previous test re-fires the
  // variant option reload, which transiently disables Continue
  // (`saveDisabled`). A DOM click on a disabled button is a silent
  // no-op, so wait for the gate to re-open before clicking.
  await waitForConfigContinueEnabled('Continue button never re-enabled after the variant pick')
  expect(await ctx.panel.click('.config-continue')).toBe(true)
  await ctx.panel.waitForVisible('.template-skip', { timeout: 10_000 })
  expect(await ctx.panel.clickByText('.template-skip', 'Skip & Install')).toBe(true)

  // Install op mounts the brand-progress takeover, then auto-launches
  // into a launch op under the same chrome. The terminal signal is
  // the comfy webContents loading a localhost URL — covers both the
  // install completing and the server coming up.
  await ctx.panel.waitForVisible('.brand-progress', { timeout: 10_000 })
  await expect.poll(comfyFrontendIsLoaded, { timeout: 480_000, intervals: [1_000, 2_000] }).toBe(true)
})

test('first-use Local chain marks firstUseCompleted once and cycles firstUseMode @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: first-use IPC log only exists on the boot that drove the chain')
  // Asserts the chain bookkeeping the auto-launch above relied on:
  //   - `markFirstUseCompleted` (set-setting firstUseCompleted=true)
  //     fires exactly once across the entire Local chain (consent →
  //     pick-local → new-install takeover → install → auto-launch).
  //   - `setFirstUseMode` advances through 'post-consent' and lands
  //     at 'none' once the new-install takeover closes.
  // Reads from the cumulative IPC invocation log captured since boot —
  // no reset, so the assertions cover the full chain end-to-end.
  const setSettingCalls = await getIpcInvocations(ctx.app, 'set-setting') as Array<{ key: string; value: unknown }>
  const firstUseFlips = setSettingCalls.filter((c) => c.key === 'firstUseCompleted' && c.value === true)
  expect(firstUseFlips.length, 'markFirstUseCompleted should run exactly once across the chain').toBe(1)

  const modeCalls = await getIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode') as Array<{ mode: string }>
  const modes = modeCalls.map((c) => c.mode)
  expect(modes, 'first-use mode sequence missing post-consent').toContain('post-consent')
  expect(modes[modes.length - 1], 'first-use mode should end at none after chain completes').toBe('none')
})

// ---------------------------------------------------------------------------
// Launch & verify split-view + dark background
// ---------------------------------------------------------------------------

test('auto-launch landed on a single host window (in-place attach) @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: install was not auto-launched on this boot')
  // In-place attach guard: the redesigned install flow has
  // `autoLaunchOnFinish: true`, so the chooser host transforms into
  // the install host without spawning a fresh BrowserWindow. The
  // previous test already polled `comfyFrontendIsLoaded` to true — at
  // this point exactly one window should exist and it should host the
  // comfy webContents. A close+open swap path would leak windows or
  // leave the original chooser host alive alongside a new install host.
  const state = await evalWithRetry(() => ctx.app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
    const comfyHost = wins.find((w) =>
      w.contentView.children.some((v) =>
        v instanceof WebContentsView &&
        /^http:\/\/(127\.0\.0\.1|localhost):/.test(v.webContents.getURL()),
      ),
    )
    return { count: wins.length, comfyHostId: comfyHost?.id ?? null }
  }))
  expect(state.count).toBe(1)
  expect(state.comfyHostId).not.toBeNull()
})

/**
 * Regression guard for #449: per-install BrowserWindow uses the title-bar +
 * content split-view (≥2 WebContentsView children) and the parent
 * BrowserWindow background is dark (#171717) so no white frame flashes
 * pre-load.
 */
test('ComfyUI window has dark background and split-view architecture @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: comfy is not auto-running on this boot')
  const arch = await evalWithRetry(() => ctx.app.evaluate(({ BrowserWindow, WebContentsView }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const children = win.contentView.children
      const comfyChild = children.find((v) =>
        v instanceof WebContentsView &&
        /^http:\/\/(127\.0\.0\.1|localhost):/.test(v.webContents.getURL()),
      ) as { getBounds(): { x: number; y: number; width: number; height: number }; getVisible(): boolean } | undefined
      if (!comfyChild) continue
      const bounds = comfyChild.getBounds()
      return {
        childCount: children.length,
        allWebContentsViews: children.every((v) => v instanceof WebContentsView),
        bg: win.getBackgroundColor(),
        comfyBounds: bounds,
        comfyVisible: comfyChild.getVisible(),
      }
    }
    return null
  }))

  expect(arch, 'ComfyUI BrowserWindow not found among open windows').not.toBeNull()
  expect(arch!.childCount).toBeGreaterThanOrEqual(2)
  expect(arch!.allWebContentsViews).toBe(true)
  expect(arch!.bg.toLowerCase()).toBe('#171717')
  // Regression guard for the chooser-pick in-place attach onto a unique-
  // partition install: rebuildComfyViewIfNeeded swaps entry.comfyView, and
  // a stale closure in layoutViews used to leave the freshly-built view
  // at default 0×0 invisible bounds — ComfyUI would load but never paint.
  expect(arch!.comfyVisible, 'comfyView is hidden').toBe(true)
  expect(arch!.comfyBounds.width, 'comfyView width is 0').toBeGreaterThan(0)
  expect(arch!.comfyBounds.height, 'comfyView height is 0').toBeGreaterThan(0)
})

// ---------------------------------------------------------------------------
// Dashboard navigation from a running install
// ---------------------------------------------------------------------------

/** Close every window except the one hosting the live ComfyUI frontend,
 *  then wait until it is the only window left. With more than one window
 *  open, marker-based facades (panel/title-bar) can bind to the wrong
 *  window's panel.html, so any test that opens an extra window must call
 *  this before handing off. Keep whichever window owns the live comfy
 *  frontend rather than trusting window ordering. The comfy frontend
 *  lives in a child WebContentsView, so identify the host by inspecting
 *  `contentView.children` (BrowserWindow.fromWebContents returns null
 *  for child-view webContents). */
async function closeExtraWindowsKeepComfyHost(): Promise<void> {
  await evalWithRetry(() => ctx.app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
    const comfyHost = wins.find((w) =>
      w.contentView.children.some((v) =>
        v instanceof WebContentsView &&
        /^http:\/\/(127\.0\.0\.1|localhost):/.test(v.webContents.getURL()),
      ),
    )
    if (!comfyHost) throw new Error('running comfy host window not found')
    for (const win of wins) {
      if (win.id !== comfyHost.id) win.close()
    }
  }))
  // Wait until only the comfy host remains so the marker-based
  // panel/title-bar facades resolve unambiguously.
  await expect
    .poll(() => evalWithRetry(() => ctx.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length,
    )), { timeout: 15_000, intervals: [200, 500] })
    .toBe(1)
}

test('picker Dashboard opens a chooser without stopping the running install @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: no running install-backed host exists')
  const before = await evalWithRetry(() => ctx.app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
    return { count: wins.length, ids: wins.map((w) => w.id) }
  }))

  // The picker Home action is the current dashboard escape. It deliberately
  // opens a chooser window so navigating home does not stop ComfyUI.
  expect(await ctx.titleBar.click('.title-install-pill.is-interactive')).toBe(true)
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible('.picker-home', { timeout: 10_000 })
  expect(await popup.click('.picker-home')).toBe(true)

  await waitForWebContents(ctx.app, 'panel.html')
  await expectChooserVisible(ctx.panel)
  await expect.poll(comfyFrontendIsLoaded, { timeout: 30_000, intervals: [500] }).toBe(true)
  const after = await evalWithRetry(() => ctx.app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
    const comfyHost = wins.find((w) =>
      w.contentView.children.some((v) =>
        v instanceof WebContentsView &&
        /^http:\/\/(127\.0\.0\.1|localhost):/.test(v.webContents.getURL()),
      ),
    )
    return { count: wins.length, comfyHostId: comfyHost?.id ?? null }
  }))
  expect(after.count).toBe(before.count + 1)
  expect(before.ids).toContain(after.comfyHostId)

  // Close the extra chooser window before handing off: later tests (and
  // section-subset runs that skip the update section entirely) must find
  // exactly one window so panel/title-bar facades bind to the comfy host.
  // Capture the install id THROUGH the extra chooser's panel first - the
  // comfy host's own panel view was destroyed by the launch attach, so
  // after the close no panel.html exists until it is remounted.
  const installs = await ctx.panel.evaluate<Array<{ id: string }>>(`window.api.getInstallations()`)
  expect(installs.length, 'no tracked installation to remount the panel for').toBeGreaterThan(0)
  await closeExtraWindowsKeepComfyHost()
  // Remount the install-backed panel (production mounts it lazily) so the
  // following tests can keep reading state via `ctx.panel.evaluate`. Same
  // dance the snapshot-capture and relaunch tests already do.
  expect(await ensureInstallPanelView(ctx.app, installs[0]!.id)).toBe(true)
  await waitForWebContents(ctx.app, 'panel.html')
})

// ---------------------------------------------------------------------------
// Real update — exercise runComfyUIUpdate end-to-end against GitHub.
//
// The install above lands on the latest stable tag. To prove the update
// path *actually does something*, force ComfyUI's working tree backwards
// a few commits via real `git reset --hard`, then drive the in-place
// `update-comfyui` action and assert the working-tree HEAD moves forward
// again. This exercises:
//   - the bundled `update_comfyui.py` script (real Python subprocess)
//   - real `git fetch` from github.com/comfyanonymous/ComfyUI
//   - real `git checkout` of the latest stable tag
//   - filtered `uv pip install -r requirements.txt` if requirements
//     changed across the rolled-back range
// ---------------------------------------------------------------------------

interface InstallationLite {
  id: string
  name: string
  installPath: string
}

/** Fill the picker's BasePrompt name input and submit it. Both copy entry
 *  points (picker More → Copy, dashboard kebab → copy-install) prompt for
 *  the new install's name through `useDialogs` → DialogHost → BasePrompt. */
async function submitCopyNamePrompt(popup: WebContentsPage, name: string): Promise<void> {
  await popup.waitForVisible(byTestId(TID.basePromptInput), { timeout: 15_000 })
  // Real text entry through Electron's input pipeline (focus + insertText),
  // not a synthetic `.value=` assignment.
  await popup.fill(byTestId(TID.basePromptInput), name)
  expect(await popup.click(byTestId(TID.basePromptAction))).toBe(true)
}

/** Wait for a copy operation to complete. The completion signal is the new
 *  registry record — main registers it only AFTER the file copy finishes
 *  (`performCopy`). Real ~500MB filesystem copy → generous timeout. */
async function waitForCopyRegistered(name: string): Promise<InstallationLite> {
  let copyRecord: InstallationLite | undefined
  await expect
    .poll(async () => {
      const installs = await ctx.panel.evaluate<InstallationLite[]>(`window.api.getInstallations()`)
      copyRecord = installs.find((i) => i.name === name)
      return copyRecord ?? null
    }, { timeout: 540_000, intervals: [2_000, 5_000] })
    .not.toBeNull()
  return copyRecord!
}

let _updateInstallId = ''
let _updateInstallPath = ''
let _comfyUIDir = ''
let _installedCommit = ''
let _installedTorchSignature: TorchSignature | null = null

interface TorchSignature {
  torch: string
  /** `torch.version.cuda` - null on CPU/MPS builds, e.g. "12.8" on CUDA builds. */
  cuda: string | null
  /** `torch.cuda.is_available()` - proves the CUDA runtime actually
   *  initializes against the local driver on NVIDIA installs (a CUDA
   *  build with a broken/missing driver still reports a cuda version). */
  cudaAvailable: boolean
  /** ROCm/HIP runtime version - non-null only on ROCm torch builds
   *  (which report null `cuda` but true `cudaAvailable`). */
  hip: string | null
  torchvision: string | null
  torchaudio: string | null
  torchsde: string | null
  torchDistInfoCount: number
}

/** Import torch through the install's REAL venv python and return the
 *  torch-family version signature. An actual import proves the package
 *  is intact (DLLs load), not merely that a dist-info directory exists;
 *  the sibling packages are read via importlib.metadata so an isolated
 *  torchvision/torchaudio/torchsde change is caught too. Used as a
 *  guard that update/restore requirements installs never touch the
 *  torch family (the PYTORCH_RE filter in src/main/lib/pip.ts): a past
 *  regression passed --upgrade to the requirements pip call, silently
 *  replacing the variant-matched torch build and breaking CUDA on
 *  Windows. */
function queryTorchSignature(): TorchSignature {
  const venvPython = process.platform === 'win32'
    ? path.join(_comfyUIDir, '.venv', 'Scripts', 'python.exe')
    : path.join(_comfyUIDir, '.venv', 'bin', 'python3')
  const probe = [
    'import json, torch',
    'from importlib import metadata',
    'def v(p):',
    '    try: return metadata.version(p)',
    '    except Exception: return None',
    'print("__TORCH_SIGNATURE__" + json.dumps({"torch": torch.__version__, "cuda": torch.version.cuda,'
      + ' "cudaAvailable": torch.cuda.is_available(), "hip": torch.version.hip,'
      + ' "torchvision": v("torchvision"), "torchaudio": v("torchaudio"), "torchsde": v("torchsde"),'
      + ' "torchDistInfoCount": sum(1 for d in metadata.distributions() if (d.metadata.get("Name") or "").lower() == "torch")}))',
  ].join('\n')
  const out = execFileSync(venvPython, ['-c', probe], {
    encoding: 'utf-8', windowsHide: true, timeout: 120_000,
  })
  // Importing torch can print to stdout before the probe's own output
  // (the ROCm universal stack emits "[WARNING] failed to run
  // offload-arch..." from rocm_sdk during import), so the JSON is
  // sentinel-prefixed and extracted rather than parsed from raw stdout.
  const line = out.split(/\r?\n/).reverse()
    .find((candidate) => candidate.startsWith('__TORCH_SIGNATURE__'))
  if (!line) {
    throw new Error(`torch signature probe produced no sentinel line; stdout was: ${out.slice(0, 500)}`)
  }
  return JSON.parse(line.slice('__TORCH_SIGNATURE__'.length)) as TorchSignature
}

/** Assert the installed torch package family is identical to the
 *  baseline captured after install. `cudaAvailable` is excluded from
 *  the equality: it is runtime driver state, not package state, and a
 *  transient driver hiccup on a GPU machine must not masquerade as a
 *  requirements install touching the torch family. */
function expectTorchFamilyUnchanged(message: string): void {
  expect(_installedTorchSignature, 'baseline torch signature not captured').not.toBeNull()
  const { cudaAvailable: _base, ...baseline } = _installedTorchSignature!
  const { cudaAvailable: _cur, ...current } = queryTorchSignature()
  expect(current, message).toEqual(baseline)
}

/** Stop the running install and land back on the dashboard through the
 *  REAL production controls: title-bar install pill -> picker footer More
 *  -> Stop -> in-drawer BaseAlert confirm -> stopped lifecycle card ->
 *  "Return to Dashboard". Replaces the old `__e2e` return hook, which
 *  bypassed every one of those controls. No-ops when ComfyUI is already
 *  stopped and the window already shows the chooser. */
async function stopAndReturnToDashboardViaUI(): Promise<void> {
  if (!(await comfyFrontendIsLoaded())) {
    const chooserUp = await ctx.panel.exists('.chooser-view').catch(() => false)
    if (chooserUp) return
  }
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar)
  await popup.waitForVisible(byTestId(TID.pickerMoreTrigger), { timeout: 15_000 })
  await popup.clickUntilVisible(byTestId(TID.pickerMoreTrigger), byTestId(TID.pinBottomAction('stop')), { timeout: 30_000 })
  expect(await popup.click(byTestId(TID.pinBottomAction('stop')))).toBe(true)
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)

  // A successful stop dismisses the drawer and swaps the host body to the
  // stopped lifecycle card (production mounts panel.html for it). The
  // stopped card can render before `confirmAndStop` resolves and emits
  // the popup's `request-dismiss`; wait for the popup to actually hide
  // so the return click below hits a visible, uncovered control.
  // Generous timeouts: Windows process-tree teardown can lag by tens of
  // seconds.
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 120_000, intervals: [250, 500],
    })
    .toBe(false)
  await waitForWebContents(ctx.app, 'panel.html')
  await ctx.panel.waitForVisible(byTestId(TID.lifecycleReturnDashboard), { timeout: 120_000 })
  expect(await ctx.panel.click(byTestId(TID.lifecycleReturnDashboard))).toBe(true)

  await expect.poll(comfyFrontendIsLoaded, { timeout: 30_000, intervals: [500] }).toBe(false)
  // `detachInstall` destroys the install-backed panel webContents and
  // mounts a fresh chooser-mode one, so there is a window where no
  // panel.html webContents exists. Poll tolerantly until the NEW panel
  // is up and showing the chooser instead of assuming continuity.
  await expect
    .poll(
      () => ctx.panel.evaluate<boolean>(`!!document.querySelector('.chooser-view')`).catch(() => false),
      { timeout: 30_000, intervals: [250, 500] },
    )
    .toBe(true)
}

test('stop ComfyUI again so update-comfyui (requires stopped) can run @sec-update @lifecycle', async () => {
  test.setTimeout(300_000)

  // Full real-UI stop + return: pill -> picker Stop -> confirm ->
  // stopped card -> Return to Dashboard. The multi-window test closes
  // its own extra window, so exactly one window (the comfy host) exists
  // here and the panel/title-bar facades resolve to it.
  await stopAndReturnToDashboardViaUI()
})

test('captures install metadata for the update tests @sec-meta @lifecycle', async () => {
  const installs = await ctx.panel.evaluate<InstallationLite[]>(
    `window.api.getInstallations()`,
  )
  expect(installs.length, 'no tracked installation after install').toBeGreaterThan(0)
  const inst = installs[0]!
  _updateInstallId = inst.id
  _updateInstallPath = inst.installPath
  _runCreatedInstallPaths.add(_updateInstallPath)
  _comfyUIDir = path.join(_updateInstallPath, 'ComfyUI')

  // The install setup in test 2 pins the second-newest stable tag,
  // so HEAD already sits on a stale stable tag — every downstream
  // update test naturally has work to do without any `git reset --hard`
  // hack against the live working tree.
  _installedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir, encoding: 'utf-8', windowsHide: true,
  }).trim()
  expect(_installedCommit).toMatch(/^[a-f0-9]{40}$/)

  // Baseline torch for the update/restore guards below: the install +
  // successful startup must have left a working, variant-matched torch.
  _installedTorchSignature = queryTorchSignature()
  expect(_installedTorchSignature.torch, 'torch failed to import from the installed venv').toBeTruthy()
  // The installed torch build must match the variant the wizard was
  // driven to in test 2. `torch.version.cuda` distinguishes the build
  // (a bare version string can still be a CUDA build, so the build tag
  // alone is not authoritative); `torch.cuda.is_available()` proves the
  // CUDA runtime actually initializes against the local driver.
  if (LIFECYCLE_VARIANT === 'nvidia') {
    expect(
      _installedTorchSignature.cuda,
      `NVIDIA-variant install must carry a CUDA torch build (torch ${_installedTorchSignature.torch})`,
    ).not.toBeNull()
    expect(
      _installedTorchSignature.cudaAvailable,
      `torch.cuda.is_available() must be true on an NVIDIA-variant install (torch ${_installedTorchSignature.torch}, cuda ${_installedTorchSignature.cuda})`,
    ).toBe(true)
  } else if (LIFECYCLE_VARIANT === 'amd') {
    // ROCm torch builds report through the CUDA API surface: null
    // `torch.version.cuda` but non-null `torch.version.hip`, and
    // `torch.cuda.is_available()` true once HIP initializes.
    expect(
      _installedTorchSignature.hip,
      `AMD-variant install must carry a ROCm torch build (torch ${_installedTorchSignature.torch})`,
    ).not.toBeNull()
    expect(
      _installedTorchSignature.cudaAvailable,
      `torch.cuda.is_available() must be true on an AMD-variant install (torch ${_installedTorchSignature.torch}, hip ${_installedTorchSignature.hip})`,
    ).toBe(true)
  } else if (LIFECYCLE_VARIANT === 'cpu') {
    expect(
      _installedTorchSignature.cuda,
      `CPU-variant install must not carry a CUDA torch build (torch ${_installedTorchSignature.torch}, cuda ${_installedTorchSignature.cuda})`,
    ).toBeNull()
    expect(
      _installedTorchSignature.cudaAvailable,
      'CPU-variant install must not initialize a CUDA runtime',
    ).toBe(false)
  }
})

test('update-comfyui drives the real updater and moves HEAD forward @sec-update @lifecycle', async () => {
  // Real update can run pip-install if requirements.txt changed
  // between the older stable tag we installed on and the
  // latest stable tag. Stretch the per-test timeout to cover that.
  test.setTimeout(600_000)
  expect(_installedCommit, 'installed commit not captured').toBeTruthy()

  // Open the picker on the Update tab through the real dashboard entry
  // controls (tile kebab -> Manage -> Update tab). The install sits one
  // stable release back, so the stable channel card resolves
  // updateAvailable and surfaces the real Update Now button.
  const popup = await openManageViaDashboard(ctx.app, ctx.panel, _updateInstallId, 'update')
  await popup.waitForSelector(byTestId(TID.updateActionButton('update-comfyui')), { timeout: 60_000 })
  expect(await popup.click(byTestId(TID.updateActionButton('update-comfyui')))).toBe(true)

  // Same-channel stable updates carry release notes → rich confirm
  // (`modal-confirm-button`); an empty-notes fallback renders BaseAlert.
  const confirmSelector =
    '[data-testid="modal-confirm-button"], [data-testid="base-alert-action"]'
  await popup.waitForVisible(confirmSelector, { timeout: 15_000 })
  expect(await popup.click(confirmSelector)).toBe(true)

  // The install is stopped, so there is no relaunch leg: the op runs to
  // completion behind the picker's progress UI. HEAD movement is the
  // observable side effect; then wait for the op slot to clear so the
  // next test starts clean.
  await expect.poll(() => execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir, encoding: 'utf-8', windowsHide: true,
  }).trim(), { timeout: 540_000, intervals: [2_000, 5_000] }).not.toBe(_installedCommit)
  await waitForOperationDrain(_updateInstallId)
  await closeTitlePopupIfOpen(ctx.app)

  const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir, encoding: 'utf-8', windowsHide: true,
  }).trim()
  expect(headAfter, 'update did not move HEAD off the installed (older stable) commit').not.toBe(_installedCommit)

  // The update should land on a commit reachable from origin/master that is
  // strictly newer than the installed (older stable) one — never older.
  const aheadCount = execFileSync('git', ['rev-list', '--count', `${_installedCommit}..${headAfter}`], {
    cwd: _comfyUIDir, encoding: 'utf-8', windowsHide: true,
  }).trim()
  expect(parseInt(aheadCount, 10), `post-update HEAD ${headAfter} is not ahead of installed commit ${_installedCommit}`).toBeGreaterThan(0)

  // The updater's requirements install must never touch the torch
  // family: an accidental --upgrade would replace the variant-matched
  // build.
  expectTorchFamilyUnchanged('update-comfyui changed the installed torch family')
})

test('re-launch ComfyUI after update validates the updated install runs @sec-update @lifecycle', async () => {
  await clickInstallTile(ctx.panel, 'ComfyUI')
  await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000] }).toBe(true)
})

interface PytorchPickerOption {
  value: string
  label: string
  version: string
  groupLabels: string[]
}

let _baselinePytorchOption: PytorchPickerOption | null = null
let _targetPytorchOption: PytorchPickerOption | null = null
let _baselinePytorchSignature: TorchSignature | null = null

async function readPytorchPicker(popup: WebContentsPage): Promise<{
  current: PytorchPickerOption
  options: PytorchPickerOption[]
}> {
  // The picker section is hidden until check-update (auto-fired on Update
  // tab open) populates the torch stack catalog cache, so poll the sections
  // API rather than the DOM: each call recomputes against the live cache.
  // Poll through the panel (the popup preload has no `window.api`); errors
  // are captured instead of thrown so the poll's last state is diagnosable.
  const query = `(async () => {
    try {
      const sections = await window.api.getDetailSections(${JSON.stringify(_updateInstallId)})
      const field = sections.flatMap((section) => section.fields || []).find((candidate) => candidate.id === 'pytorchStack')
      if (!field) return { current: null, options: [], detail: 'fields: ' + JSON.stringify(sections.flatMap((s) => (s.fields || []).map((f) => f.id))) }
      const options = (field.options || []).map((option) => ({
        value: option.value,
        label: option.label,
        version: String(option.data?.latestVersion || '').replace(/^[vV]/, ''),
        groupLabels: (option.groupPath || []).map((group) => group.label),
      }))
      return { current: options.find((option) => option.value === String(field.value)) || null, options, detail: '' }
    } catch (err) {
      return { current: null, options: [], detail: 'error: ' + String(err) }
    }
  })()`
  type PickerRead = { current: PytorchPickerOption | null; options: PytorchPickerOption[]; detail: string }
  let result: PickerRead = { current: null, options: [], detail: 'never evaluated' }
  await expect.poll(async () => {
    result = await ctx.panel.evaluate<PickerRead>(query)
    return result.options.length > 0
  }, {
    timeout: 180_000, intervals: [1_000, 2_000],
    message: `pytorchStack field never gained options; last state: ${result.detail}`,
  }).toBe(true)
  await popup.waitForVisible('button[role="combobox"][aria-label="PyTorch"]', { timeout: 60_000 })
  expect(result.current, 'PyTorch picker has no catalog option matching the installed stack').not.toBeNull()
  return { current: result.current!, options: result.options }
}

async function selectPytorchOption(popup: WebContentsPage, option: PytorchPickerOption): Promise<void> {
  for (let level = 0; level < option.groupLabels.length; level++) {
    const groupSelect = `${byTestId(TID.channelGroupSelect(level))} button[role="combobox"]`
    await popup.waitForVisible(groupSelect, { timeout: 60_000 })
    expect(await popup.click(groupSelect)).toBe(true)
    await popup.waitForVisible('[role="listbox"] [role="option"]', { timeout: 10_000 })
    expect(await popup.clickByText('[role="listbox"] [role="option"]', option.groupLabels[level]!)).toBe(true)
  }
  const stackSelect = 'button[role="combobox"][aria-label="PyTorch"]'
  await popup.waitForVisible(stackSelect, { timeout: 60_000 })
  expect(await popup.click(stackSelect)).toBe(true)
  await popup.waitForVisible('[role="listbox"] [role="option"]', { timeout: 10_000 })
  expect(await popup.clickByText('[role="listbox"] [role="option"]', option.label)).toBe(true)
}

async function changePytorchStack(option: PytorchPickerOption): Promise<void> {
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'update')
  await selectPytorchOption(popup, option)
  const action = byTestId(TID.updateActionButton('change-pytorch'))
  await popup.waitForVisible(action, { timeout: 60_000 })
  expect(await popup.click(action)).toBe(true)
  const confirm = '[data-testid="modal-confirm-button"], [data-testid="base-alert-action"]'
  await popup.waitForVisible(confirm, { timeout: 15_000 })
  expect(await popup.click(confirm)).toBe(true)
  await waitForProgressTakeoverAfterPopupClose()
  // Do NOT probe the venv while the transaction runs: the probe spawns
  // the venv python, whose torch import holds .pyd files open exactly
  // while uv tries to delete them - on Windows that races the
  // transaction into "Access is denied" and fails the real product
  // operation. Wait for the app-side operation to drain first; only
  // then is the venv safe to touch.
  await waitForOperationDrain(
    _updateInstallId,
    GPU_VARIANT ? 2_400_000 : 900_000,
  )
  // Post-drain the venv is stable; the short poll only absorbs probe
  // startup transients (expect.poll aborts on exceptions, so map them
  // to null instead).
  await expect.poll(() => {
    try {
      return queryTorchSignature().torch
    } catch {
      return null
    }
  }, { timeout: 120_000, intervals: [2_000, 5_000] }).toBe(option.version)
  await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000, 2_000] }).toBe(true)
  await closeTitlePopupIfOpen(ctx.app)

  const verifyPopup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'update')
  const picker = await readPytorchPicker(verifyPopup)
  expect(picker.current.value).toBe(option.value)
  await expect.poll(() => verifyPopup.textOf('button[role="combobox"][aria-label="PyTorch"]')).toContain(option.label)
  await closeTitlePopupIfOpen(ctx.app)
}

test('captures the baseline pytorch stack @sec-pytorch @lifecycle', async () => {
  test.setTimeout(300_000)
  // The torch stack catalog is only populated by check-update; fire one
  // deterministically (the Update tab's auto-check is silent and may have
  // raced or failed earlier in the run) before reading the picker.
  await ctx.panel.evaluate(
    `window.api.runAction(${JSON.stringify(_updateInstallId)}, 'check-update', { silent: true })`
  )
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'update')
  const picker = await readPytorchPicker(popup)
  _baselinePytorchOption = picker.current
  _baselinePytorchSignature = queryTorchSignature()
  expect(_baselinePytorchOption.label).toBeTruthy()
  expect(_baselinePytorchOption.value).toBeTruthy()
  expect(_baselinePytorchSignature.torch).toBe(_baselinePytorchOption.version)
  await closeTitlePopupIfOpen(ctx.app)
})

test('switches to a different compatible stack via the picker @sec-pytorch @lifecycle', async () => {
  test.setTimeout(GPU_VARIANT ? 2_700_000 : 1_200_000)
  expect(_baselinePytorchOption, 'baseline PyTorch picker option not captured').not.toBeNull()
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'update')
  const picker = await readPytorchPicker(popup)
  _targetPytorchOption = picker.options.find((option) =>
    option.value !== _baselinePytorchOption!.value && !/nightly|\.dev/i.test(`${option.label} ${option.value}`),
  ) ?? picker.options.find((option) => option.value !== _baselinePytorchOption!.value) ?? null
  await closeTitlePopupIfOpen(ctx.app)
  expect(_targetPytorchOption, 'PyTorch picker has no compatible alternative stack').not.toBeNull()
  await changePytorchStack(_targetPytorchOption!)
})

test('venv reflects the switched stack @sec-pytorch @lifecycle', async () => {
  expect(_targetPytorchOption, 'target PyTorch picker option not captured').not.toBeNull()
  expect(_baselinePytorchSignature, 'baseline PyTorch signature not captured').not.toBeNull()
  const switched = queryTorchSignature()
  expect(switched.torch).toBe(_targetPytorchOption!.version)
  expect(switched.torch).not.toBe(_baselinePytorchSignature!.torch)
  expect(switched.torchDistInfoCount, 'venv must contain exactly one torch distribution').toBe(1)
  if (LIFECYCLE_VARIANT === 'nvidia') {
    expect(switched.cuda, 'NVIDIA stack must report a CUDA runtime version').not.toBeNull()
  } else if (LIFECYCLE_VARIANT === 'amd') {
    expect(switched.hip, 'AMD stack must report a ROCm/HIP runtime version').not.toBeNull()
  } else if (LIFECYCLE_VARIANT === 'cpu') {
    expect(switched.cuda, 'CPU stack must not report a CUDA runtime version').toBeNull()
    expect(switched.torch, 'CPU stack must not carry a CUDA local-version suffix').not.toMatch(/\+cu\d+/i)
  }
})

test('switches back to the baseline pytorch stack @sec-pytorch @lifecycle', async () => {
  test.setTimeout(GPU_VARIANT ? 2_700_000 : 1_200_000)
  expect(_baselinePytorchOption, 'baseline PyTorch picker option not captured').not.toBeNull()
  expect(_baselinePytorchSignature, 'baseline PyTorch signature not captured').not.toBeNull()
  await changePytorchStack(_baselinePytorchOption!)
  // `cudaAvailable` is runtime driver state, not package state - a
  // transient driver hiccup on a GPU machine must not fail the restore.
  const { cudaAvailable: _cur, ...restored } = queryTorchSignature()
  const { cudaAvailable: _base, ...baseline } = _baselinePytorchSignature!
  expect(restored).toEqual(baseline)
})

// ---------------------------------------------------------------------------
// FLOW 1 — IN_PLACE_RELAUNCH coverage via the real picker UI.
//
// The existing direct-runAction update test above covers the stopped-install
// code path. These tests cover the running-install path: the user opens the
// picker against a live ComfyUI, clicks Update Now (or Restore Snapshot),
// confirms in the popup's own dialog, and the panel-side apiCall wrapper
// self-stops + runs the op + relaunches in place. Each test re-uses the
// real ~500MB install the lifecycle suite already built and drives the
// actions through real DOM gestures.
// ---------------------------------------------------------------------------

interface SnapshotSummaryLite {
  filename: string
  label: string | null
}
interface SnapshotListLite { snapshots: SnapshotSummaryLite[] }

interface RunActionInvocation {
  installationId?: string
  actionId?: string
}

/** Waits for either the picker's inline progress or a panel takeover. */
async function waitForProgressTakeoverAfterPopupClose(): Promise<void> {
  const routedInline = await expect
    .poll(async () => {
      if (!(await isPopupVisible(ctx.app, 'comfyTitlePopup.html'))) return 'panel'
      const text = await titlePopupPage(ctx.app).textOf('.picker-detail')
      return /Updating|Restoring|Restarting|Copying|Changing/i.test(text ?? '') ? 'inline' : 'pending'
    }, { timeout: 30_000, intervals: [100, 250] })
    .not.toBe('pending')
    .then(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'))
  if (!routedInline) await ctx.panel.waitForVisible('.brand-progress', { timeout: 30_000 })
}

/** Polls until a `run-action` IPC for `installationId` with `actionId`
 *  has been recorded. Wraps the long-budget poll the picker-driven
 *  update / restore / restart tests need to wait for the IN_PLACE_RELAUNCH
 *  launch leg. */
async function waitForRunAction(
  installationId: string, actionId: string,
  opts: { timeout?: number; intervals?: number[] } = {},
): Promise<void> {
  await expect
    .poll(async () => {
      const calls = (await getIpcInvocations(ctx.app, 'run-action')) as RunActionInvocation[]
      return calls.some((c) => c.installationId === installationId && c.actionId === actionId)
    }, { timeout: opts.timeout ?? 540_000, intervals: opts.intervals ?? [2_000, 5_000] })
    .toBe(true)
}

async function getRunActionsFor(installationId: string): Promise<RunActionInvocation[]> {
  const calls = (await getIpcInvocations(ctx.app, 'run-action')) as RunActionInvocation[]
  return calls.filter((c) => c.installationId === installationId)
}

async function getStopsFor(installationId: string): Promise<string[]> {
  // `registerSessionHandlers` records the handler's first arg, which for
  // `stop-comfyui` is the bare installationId string (not an object).
  const calls = (await getIpcInvocations(ctx.app, 'stop-comfyui')) as string[]
  return calls.filter((c) => c === installationId)
}

/** Waits until main releases the per-install background-operation slot.
 *  Op-heavy tests resolve on observable side effects (HEAD movement,
 *  frontend load) before main finishes dependency work and the post-op
 *  snapshot; firing the next op while the slot is held gets rejected
 *  with "Another operation is already running." */
async function waitForOperationDrain(installationId: string, timeout = 300_000): Promise<void> {
  await expect
    .poll(() => hasActiveOperation(ctx.app, installationId), {
      timeout, intervals: [1_000, 2_000],
    })
    .toBe(false)
}

let _restoreSnapshotFilename = ''
let _snapshotHeadAtCapture = ''

test('captures a snapshot for the picker-driven restore test @sec-snapshot @lifecycle', async () => {
  // ComfyUI is running from the prior re-launch test. Captured label
  // gives us a stable filename to grab in the restore test below.
  expect(_updateInstallId, 'update install id not captured').toBeTruthy()
  // Harness observability, not part of the flow under test:
  // `clickInstallTile` in test 11 triggers `onLaunch`'s chooser-pick
  // attach which calls `destroyPanelView(claimed)` (index.ts) without
  // remounting — production lazily mounts a fresh install-backed
  // panel on the next Settings click / comfy-lifecycle body, so
  // `panel.html` doesn't exist while ComfyUI is the active body.
  // The remaining tests in this file read state via `ctx.panel.evaluate`
  // for their assertions; do the lazy mount ourselves once here.
  expect(await ensureInstallPanelView(ctx.app, _updateInstallId)).toBe(true)
  await waitForWebContents(ctx.app, 'panel.html')

  // Capture the pre-existing filenames first: a reused profile can carry
  // a same-labelled snapshot from a prior run, and the poll below must
  // prove THIS Save produced a new one, not match a stale leftover.
  const filenamesBefore = new Set(
    (await ctx.panel.evaluate<SnapshotListLite>(
      `window.api.getSnapshots(${JSON.stringify(_updateInstallId)})`,
    )).snapshots.map((s) => s.filename),
  )

  // Real capture flow: title pill -> picker Snapshots tab -> Create
  // Snapshot CTA -> label prompt -> confirm. `snapshot-save` is NOT in
  // REQUIRES_STOPPED so it runs against the live install — the snapshot
  // just records the current state.
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'snapshots')
  await popup.waitForVisible(byTestId(TID.snapshotsSaveCta), { timeout: 15_000 })
  expect(await popup.click(byTestId(TID.snapshotsSaveCta))).toBe(true)
  await popup.waitForVisible(byTestId(TID.basePromptInput), { timeout: 15_000 })
  await popup.fill(byTestId(TID.basePromptInput), 'lifecycle-restore-target')
  expect(await popup.click(byTestId(TID.basePromptAction))).toBe(true)

  // The capture runs behind the prompt confirm; poll until the labelled
  // snapshot lands in the registry.
  let target: SnapshotListLite['snapshots'][number] | undefined
  await expect
    .poll(async () => {
      const list = await ctx.panel.evaluate<SnapshotListLite>(
        `window.api.getSnapshots(${JSON.stringify(_updateInstallId)})`,
      )
      target = list.snapshots.find(
        (s) => s.label === 'lifecycle-restore-target' && !filenamesBefore.has(s.filename),
      )
      return target ?? null
    }, { timeout: 30_000, intervals: [500, 1_000] })
    .not.toBeNull()

  // Capture a second snapshot on top so the restore target is never the
  // newest row: SnapshotsView hides Restore on the latest snapshot
  // (restoring it is a no-op). The full chain gets this for free from the
  // cross-channel update's pre/post-update snapshots, but the @sec-snapshot
  // subset runs capture -> restore directly and must not depend on other
  // suites having run in between.
  await popup.waitForVisible(byTestId(TID.snapshotsSaveCta), { timeout: 15_000 })
  expect(await popup.click(byTestId(TID.snapshotsSaveCta))).toBe(true)
  await popup.waitForVisible(byTestId(TID.basePromptInput), { timeout: 15_000 })
  await popup.fill(byTestId(TID.basePromptInput), 'lifecycle-latest-marker')
  expect(await popup.click(byTestId(TID.basePromptAction))).toBe(true)
  await expect
    .poll(async () => {
      const list = await ctx.panel.evaluate<SnapshotListLite>(
        `window.api.getSnapshots(${JSON.stringify(_updateInstallId)})`,
      )
      return list.snapshots.find(
        (s) => s.label === 'lifecycle-latest-marker' && !filenamesBefore.has(s.filename),
      ) ?? null
    }, { timeout: 30_000, intervals: [500, 1_000] })
    .not.toBeNull()

  await closeTitlePopupIfOpen(ctx.app)
  _restoreSnapshotFilename = target!.filename
  _snapshotHeadAtCapture = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir, encoding: 'utf-8', windowsHide: true,
  }).trim()
  expect(_snapshotHeadAtCapture).toMatch(/^[a-f0-9]{40}$/)
})

// ---------------------------------------------------------------------------
// Manager security level + network mode: the per-install selections on the
// picker's Startup Args tab must reach the config.ini ComfyUI-Manager
// actually reads, via a real stop -> relaunch (handleLaunch's reconcile pass
// runs before every local launch with the launched install's own record
// values). Beyond the file check, the live server is probed through
// Manager's real HTTP API to confirm the running Manager *enforces* the
// security level, and the launched server's own startup log is checked to
// confirm the running Manager *loaded* the network mode (its middle+
// network-position gate only differs behind a non-loopback --listen, which
// this loopback-bound suite cannot probe).
// ---------------------------------------------------------------------------

test('per-install Manager security level + network mode land in Manager config.ini and apply after relaunch @sec-manager @lifecycle', async () => {
  test.setTimeout(600_000)
  expect(_updateInstallPath, 'install path not captured').toBeTruthy()

  // English labels for the four levels, keyed by stored value. A fresh
  // record has no stored value and must render the pinned default
  // (normal); a reused profile may carry a level from a prior run, so
  // derive both the expected initial label and a distinct target from
  // the persisted record instead of hardcoding them.
  const LEVEL_LABELS: Record<string, string> = {
    strong: 'Strict',
    normal: 'Standard (recommended)',
    'normal-': 'Relaxed',
    weak: 'Permissive',
  }
  // English labels for the four Manager v4 network modes, keyed likewise.
  const MODE_LABELS: Record<string, string> = {
    public: 'Public (default)',
    private: 'Private',
    offline: 'Offline',
    personal_cloud: 'Personal cloud',
  }
  // The file ComfyUI-Manager actually reads (modern system-user-api path).
  const configPath = path.join(_updateInstallPath, 'ComfyUI', 'user', '__manager', 'config.ini')
  /** A `[default]` option's value, or null when the file/key is absent. */
  const readConfigOption = (key: string): string | null => {
    if (!existsSync(configPath)) return null
    const section = readFileSync(configPath, 'utf-8')
      .split(/^\[/m).find((s) => s.startsWith('default]')) ?? ''
    // Option keys are matched case-insensitively with flexible delimiters,
    // mirroring Python configparser (section names stay case-sensitive:
    // Manager only reads the exact `[default]`). Take the LAST match:
    // Manager parses with strict=False, where later duplicates win, so a
    // first-match read could hide a bad reconciliation.
    const matches = [...section.matchAll(new RegExp(`^\\s*${key}\\s*[=:]\\s*(\\S+)\\s*$`, 'gim'))]
    return matches.at(-1)?.[1] ?? null
  }
  const readConfigLevel = (): string | null => readConfigOption('security_level')
  const readConfigMode = (): string | null => readConfigOption('network_mode')
  /** An install-record field's persisted value, straight from the record. */
  const readRecordField = (field: string): Promise<string | null> =>
    ctx.panel.evaluate<string | null>(
      `window.api.getInstallations().then((list) => {
        const inst = list.find((i) => i.id === ${JSON.stringify(_updateInstallId)})
        return (inst && inst[${JSON.stringify(field)}]) || null
      })`,
    )
  const readRecordLevel = (): Promise<string | null> => readRecordField('managerSecurityLevel')
  const readRecordMode = (): Promise<string | null> => readRecordField('managerNetworkMode')

  /** Origin of the running ComfyUI server, from the loaded frontend webContents. */
  const comfyOrigin = async (): Promise<string> => {
    const origin = await ctx.app.evaluate(({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => /^http:\/\/(127\.0\.0\.1|localhost):/.test(w.getURL()))
      return wc ? new URL(wc.getURL()).origin : null
    })
    expect(origin, 'no running ComfyUI frontend to derive the server origin from').toBeTruthy()
    return origin!
  }
  // Enforcement probe against the LIVE server: POST the packaged Manager's
  // middle-risk /v2/snapshot/remove with a snapshot name that cannot exist.
  // Manager checks is_allowed_security_level('middle') before touching
  // anything and removing a nonexistent snapshot is a no-op, so the call
  // observes enforcement without mutating the install: 403 iff the running
  // Manager loaded `strong` (the security gate is this route's only 403 -
  // its CSRF content-type rejection returns 400), 200 otherwise. A 404/405
  // means Manager isn't serving its API at all and fails the probe loudly.
  // The middle gate is the level's only clean observable here - git-url/pip
  // installs are gated by dedicated config flags, and the high gate also
  // depends on --listen exposure.
  const probeTarget = `lifecycle-enforcement-probe-${randomUUID()}`
  const managerBlocksMiddleRisk = async (): Promise<boolean> => {
    // The allowed arm is only a guaranteed no-op while no snapshot by this
    // name exists - assert that invariant instead of assuming it.
    const probeSnapshotPath = path.join(
      _updateInstallPath, 'ComfyUI', 'user', '__manager', 'snapshots', `${probeTarget}.json`,
    )
    expect(existsSync(probeSnapshotPath), `probe snapshot unexpectedly exists: ${probeSnapshotPath}`)
      .toBe(false)
    const res = await fetch(
      `${await comfyOrigin()}/api/v2/snapshot/remove?target=${encodeURIComponent(probeTarget)}`,
      { method: 'POST', signal: AbortSignal.timeout(15_000) },
    )
    if (res.status !== 403) {
      expect(res.status, `unexpected snapshot/remove probe status ${res.status}`).toBe(200)
      return false
    }
    return true
  }
  /** Whether Manager's middle-risk gate blocks at a given level. */
  const middleBlockedAt = (level: string | null): boolean => level === 'strong'

  // Production degrades an unrecognized record value to the default, so
  // normalize the same way before deriving the expected trigger label.
  const storedRaw = await readRecordLevel()
  const storedBefore = storedRaw != null && Object.hasOwn(LEVEL_LABELS, storedRaw) ? storedRaw : null
  const initialLabel = LEVEL_LABELS[storedBefore ?? 'normal']!
  // The target must differ from BOTH the persisted record and whatever
  // the on-disk config currently says - otherwise a broken/no-op launch
  // reconciliation could pass vacuously against a config that already
  // carried the target. Four levels guarantee a distinct pick exists.
  // `strong` is preferred so the usual (fresh-profile) run lands on the
  // level whose enforcement is observable through the middle-risk probe.
  const configLevelBefore = readConfigLevel()
  const targetValue = (['strong', 'weak', 'normal-'] as const).find(
    (v) => v !== storedBefore && v !== configLevelBefore,
  )!
  const target = { value: targetValue, label: LEVEL_LABELS[targetValue]! }

  // Same discipline for the network mode: normalize the persisted record
  // the way production does, then pick a target differing from BOTH the
  // record and the current config so the post-relaunch assertion observes
  // a real disk transition. `personal_cloud` is preferred - it is the mode
  // Desktop users actually need (installs under a non-loopback --listen)
  // and, like every mode here, changes nothing else on a loopback bind.
  // `offline` is never picked: it would disable Manager's registry fetch
  // for later suite runs against a reused profile.
  const storedModeRaw = await readRecordMode()
  const storedModeBefore =
    storedModeRaw != null && Object.hasOwn(MODE_LABELS, storedModeRaw) ? storedModeRaw : null
  const initialModeLabel = MODE_LABELS[storedModeBefore ?? 'public']!
  const configModeBefore = readConfigMode()
  const targetModeValue = (['personal_cloud', 'private', 'public'] as const).find(
    (v) => v !== storedModeBefore && v !== configModeBefore,
  )!
  const targetMode = { value: targetModeValue, label: MODE_LABELS[targetModeValue]! }

  // Both settings are per-install; the picker edits must leave the global
  // settings store untouched. Snapshot (rather than assert emptiness) so
  // a reused profile carrying a stray settings.json key can't flake this.
  const globalBefore = await ctx.panel.evaluate<string | null>(
    `window.api.getSetting('managerSecurityLevel')`,
  )
  const globalModeBefore = await ctx.panel.evaluate<string | null>(
    `window.api.getSetting('managerNetworkMode')`,
  )

  // Real entry: running host title pill -> picker Startup Args tab, the
  // per-install surface this setting lives on.
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'config')

  // The Startup Args tab hosts several BaseSelects (launch mode, browser
  // partition, port conflict); the aria-label pins the manager one. Its
  // trigger must show the level matching the persisted record - the
  // pinned default on a fresh profile (guards against grabbing the wrong
  // control as much as against a wrong default).
  const trigger = 'button.ui-select-trigger[aria-label="Manager Security Level"]'
  await popup.waitForVisible(trigger, { timeout: 15_000 })
  expect(await popup.textOf(trigger)).toContain(initialLabel)

  // Real DOM gestures: open the listbox and pick the target level. Retried
  // as a whole cycle - a store-driven re-render can swap the option node
  // between query and click and silently swallow a single raw click.
  await popup.selectOption(trigger, target.label)

  // The picker field handler persists through the real installations
  // store; wait for the write so the relaunch below cannot race it.
  await expect
    .poll(readRecordLevel, { timeout: 10_000, intervals: [100, 250] })
    .toBe(target.value)

  // Same real gesture on the paired Manager Network Mode select, which
  // shares the security level's row in the Startup Args tab.
  const modeTrigger = 'button.ui-select-trigger[aria-label="Manager Network Mode"]'
  await popup.waitForVisible(modeTrigger, { timeout: 15_000 })
  expect(await popup.textOf(modeTrigger)).toContain(initialModeLabel)
  await popup.selectOption(modeTrigger, targetMode.label)
  await expect
    .poll(readRecordMode, { timeout: 10_000, intervals: [100, 250] })
    .toBe(targetMode.value)

  // Per-install means per-install: the global settings store must not
  // change as a side effect of the picker edits.
  expect(
    await ctx.panel.evaluate<string | null>(`window.api.getSetting('managerSecurityLevel')`),
    'managerSecurityLevel leaked into the global settings store',
  ).toBe(globalBefore)
  expect(
    await ctx.panel.evaluate<string | null>(`window.api.getSetting('managerNetworkMode')`),
    'managerNetworkMode leaked into the global settings store',
  ).toBe(globalModeBefore)
  await closeTitlePopupIfOpen(ctx.app)

  // Changing the settings alone must NOT touch the config - only the
  // launch-time reconcile pass may. This pins that the assertion after
  // relaunch observes a real disk transition, not pre-existing content.
  expect(
    readConfigLevel(),
    'Manager config changed before relaunch - reconcile must only run on launch',
  ).toBe(configLevelBefore)
  expect(
    readConfigMode(),
    'Manager network_mode changed before relaunch - reconcile must only run on launch',
  ).toBe(configModeBefore)

  // The still-running server must keep enforcing its LAUNCH-time level:
  // Manager reads config.ini once at startup, so the picker edit alone
  // must not change live behavior. Every launch in this suite reconciles
  // the config first, so the running level equals the pre-edit file
  // content; skip when that content is unrecognizable (hand-mutated
  // reused profile), since production would have degraded it at launch.
  if (configLevelBefore === null || Object.hasOwn(LEVEL_LABELS, configLevelBefore)) {
    expect(
      await managerBlocksMiddleRisk(),
      'live Manager enforcement changed before relaunch - the level must only apply at startup',
    ).toBe(middleBlockedAt(configLevelBefore))
  }

  // Full real stop -> relaunch so handleLaunch's reconcile pass runs
  // against the on-disk install.
  await stopAndReturnToDashboardViaUI()
  await clickInstallTile(ctx.panel, 'ComfyUI')
  await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000, 2_000] }).toBe(true)
  // Same lazy panel remount dance as the snapshot test above - the
  // chooser-pick attach destroyed the install-backed panel webContents.
  expect(await ensureInstallPanelView(ctx.app, _updateInstallId)).toBe(true)
  await waitForWebContents(ctx.app, 'panel.html')

  // The chosen values must land in [default] of the file Manager actually
  // reads - genuine disk transitions, since both targets were picked to
  // differ from the pre-relaunch config content.
  expect(existsSync(configPath), `Manager config not written at ${configPath}`).toBe(true)
  expect(
    readConfigLevel(),
    `[default] security_level = ${target.value} missing from Manager config:\n`
      + readFileSync(configPath, 'utf-8'),
  ).toBe(target.value)
  expect(
    readConfigMode(),
    `[default] network_mode = ${targetMode.value} missing from Manager config:\n`
      + readFileSync(configPath, 'utf-8'),
  ).toBe(targetMode.value)

  // The file check alone would pass even if Manager ignored the config -
  // probe the relaunched server's real API to confirm the running Manager
  // enforces the selected level (403 on middle-risk actions at `strong`,
  // allowed otherwise). With the strong-first target pick, the normal
  // fresh-profile run exercises the blocked arm - a genuine behavioral
  // flip from the pre-relaunch probe above.
  expect(
    await managerBlocksMiddleRisk(),
    `running Manager does not enforce security level "${target.value}"`,
  ).toBe(middleBlockedAt(target.value))

  // Same idea for the network mode: prove the RUNNING Manager loaded it,
  // not just that the file carries it. Manager v4 logs its loaded mode at
  // import ("[ComfyUI-Manager] network_mode: <mode>", from config, not the
  // file path Desktop wrote), and the launcher pipes the server's stdout to
  // a per-launch logs/comfyui.log (flags 'w', so no stale line from an
  // earlier launch can satisfy this). The mode's behavioral gate (middle+
  // actions behind a non-loopback --listen) cannot flip on this suite's
  // loopback bind, so the loaded-config log is the strongest live signal.
  const serverLogPath = path.join(_updateInstallPath, 'logs', 'comfyui.log')
  // Exact line match (not substring): a duplicate/malformed config could make
  // Manager log a mode that merely starts with the expected value.
  const expectedModeLine = `[ComfyUI-Manager] network_mode: ${targetMode.value}`
  await expect
    .poll(
      () => existsSync(serverLogPath)
        && readFileSync(serverLogPath, 'utf-8').split(/\r?\n/)
          .some((l) => l.trim().endsWith(expectedModeLine)),
      { timeout: 30_000, intervals: [500, 1_000] },
    )
    .toBe(true)

  // The extra relaunch must not have disturbed the installed torch build.
  expectTorchFamilyUnchanged('manager security-level relaunch changed the installed torch family')
})

// ---------------------------------------------------------------------------
// Picker-driven update — driven through the picker's ChannelPicker.
// Drafts a non-current channel ('latest') in the BaseSelect, clicks the
// per-channel Update Now button, and waits for the IN_PLACE_RELAUNCH
// chain to complete. Pins the bug where `actionData.channel` on the
// drafted action came off the sections payload as a Vue reactive proxy
// and threw `"An object could not be cloned"` synchronously inside the
// popup's `bridge.pickerForwardShowProgress` → `ipcRenderer.send` —
// silently swallowing the show-progress hand-off so the user got stuck
// on the picker with no feedback (fix in `InstancePickerView.vue`
// `handleSettingsShowProgress` deep-clones `actionData` first).
//
// This is the single picker-driven update test in the suite. A
// same-channel sibling used to exist but was deleted: the install
// already updated to the latest stable in the direct-runAction test
// above, so a same-channel stable picker click would have no
// `updateAvailable` (the Update Now button wouldn't render). The
// cross-channel path exercises the same `InstancePickerView` →
// `pickerForwardShowProgress` → main → runAction IPC chain plus the
// drafted-channel payload, which is the bug class that was
// regressing — the same-channel variant added no unique coverage
// beyond what's asserted below.
// ---------------------------------------------------------------------------

test('picker-driven cross-channel update-comfyui (stable → latest) IN_PLACE_RELAUNCH while running @sec-crosschannel @lifecycle', async () => {
  // Real cross-channel update: switches the install's `updateChannel`
  // from `stable` to `latest`, runs the master-branch update, then
  // relaunches in place. Stretch the timeout to cover a possible
  // `uv pip install -r requirements.txt` if requirements changed
  // between the stable release and master.
  test.setTimeout(600_000)

  // Sanity: install is on stable before drafting latest.
  const installsBefore = await ctx.panel.evaluate<Array<{ id: string; updateChannel?: string }>>(
    `window.api.getInstallations()`,
  )
  const before = installsBefore.find((i) => i.id === _updateInstallId)
  expect(before?.updateChannel, 'install must be on stable before the cross-channel switch').toBe('stable')

  const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir, encoding: 'utf-8', windowsHide: true,
  }).trim()

  await resetIpcInvocations(ctx.app, 'stop-comfyui')
  await resetIpcInvocations(ctx.app, 'run-action')

  // Open the picker through the running host's title pill onto the
  // Update tab. Channel metadata loads via real `check-update` against
  // github.com for both stable and latest — `latest` reports an update
  // against the master tip, so its cross-channel Update Now button
  // comes alive.
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'update')

  // ChannelPicker renders a BaseSelect (`role="combobox"`); the
  // dropdown's options are `role="option"` with the channel label.
  // Drafting a non-current channel mutates `state.draft` but does not
  // commit — the per-channel `selectedActions` switch to the drafted
  // channel's `{ update-comfyui, copy-update, switch-channel }` set.
  // The aria-label scopes to the channel select: the popup remembers its
  // last tab (e.g. Startup Args, which hosts several other comboboxes),
  // so an unscoped combobox match can race the tab-content swap and grab
  // a launch-settings select instead.
  const channelSelect = 'button[role="combobox"][aria-label="Update Channel"]'
  await popup.waitForSelector(channelSelect, { timeout: 60_000 })
  expect(await popup.click(channelSelect)).toBe(true)
  await popup.waitForVisible('[role="listbox"] [role="option"]', { timeout: 10_000 })
  expect(
    await popup.clickByText('[role="listbox"] [role="option"]', 'Latest on GitHub'),
    '"Latest on GitHub" option missing from BaseSelect listbox',
  ).toBe(true)

  // The cross-channel Update Now button appears once `updateAvailable`
  // resolves true for `latest` (true whenever master is ahead of the
  // installed commit — usually always against a stable release).
  await popup.waitForSelector(byTestId(TID.updateActionButton('update-comfyui')), { timeout: 60_000 })
  expect(await popup.click(byTestId(TID.updateActionButton('update-comfyui')))).toBe(true)

  // `latest` is master-tip — no GitHub release object → empty
  // `releaseNotes` → `confirm.messageDetails` undefined → ModalDialog
  // routes the confirm through its BaseAlert primitive (no rich
  // message-details UI), whose primary button defaults to
  // `data-testid="base-alert-action"`. (Same-channel stable picks up
  // release notes and stays on the legacy `TID.modalConfirm` path.)
  const confirmSelector = '[data-testid="base-alert-action"]'
  await popup.waitForVisible(confirmSelector, { timeout: 15_000 })
  expect(await popup.click(confirmSelector)).toBe(true)

  await waitForProgressTakeoverAfterPopupClose()

  await expect.poll(() => execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir, encoding: 'utf-8', windowsHide: true,
  }).trim(), { timeout: 540_000, intervals: [2_000, 5_000] }).not.toBe(headBefore)
  await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000, 2_000] }).toBe(true)

  // Channel actually switched on the InstallationRecord.
  const installsAfter = await ctx.panel.evaluate<Array<{ id: string; updateChannel?: string }>>(
    `window.api.getInstallations()`,
  )
  const after = installsAfter.find((i) => i.id === _updateInstallId)
  expect(
    after?.updateChannel,
    'updateChannel must flip to latest after a cross-channel update',
  ).toBe('latest')

  // HEAD moved to a real master commit (latest is master-tip).
  const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir, encoding: 'utf-8', windowsHide: true,
  }).trim()
  expect(headAfter, 'cross-channel update did not move HEAD').not.toBe(headBefore)
  expect(headAfter).toMatch(/^[a-f0-9]{40}$/)

  // The cross-channel updater's requirements install must never touch
  // the torch family (same guard as the stopped-path update test).
  expectTorchFamilyUnchanged('cross-channel update-comfyui changed the installed torch family')

  // Inline-picker routing keeps the popup open on its success screen;
  // close it so the next test's title-pill entry opens the picker
  // instead of toggling it shut.
  await closeTitlePopupIfOpen(ctx.app)
})

test('picker-driven snapshot-restore IN_PLACE_RELAUNCH while running @sec-snapshot @lifecycle', async () => {
  test.setTimeout(600_000)
  expect(_restoreSnapshotFilename, 'restore-target snapshot not captured').toBeTruthy()

  // Don't roll HEAD back while the previous update op still owns the
  // slot — it would race the updater's dependency work.
  await waitForOperationDrain(_updateInstallId)

  // Move HEAD off the snapshot commit so the restore has work to do.
  // Use a parent of the snapshot commit so restore lands somewhere
  // different from the current working tree.
  execFileSync('git', ['reset', '--hard', `${_snapshotHeadAtCapture}~5`], {
    cwd: _comfyUIDir, stdio: 'pipe', windowsHide: true,
  })
  const rolledBack = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir, encoding: 'utf-8', windowsHide: true,
  }).trim()
  expect(rolledBack, 'rollback did not change HEAD off the snapshot commit').not.toBe(_snapshotHeadAtCapture)

  await resetIpcInvocations(ctx.app, 'stop-comfyui')
  await resetIpcInvocations(ctx.app, 'run-action')

  // Real entry: running host title pill -> picker Snapshots tab.
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'snapshots')
  // Expand the snapshot row to reveal Restore.
  await popup.waitForSelector(byTestId(TID.snapshotRow(_restoreSnapshotFilename)), { timeout: 30_000 })
  await popup.clickUntilVisible(
    byTestId(TID.snapshotRow(_restoreSnapshotFilename)),
    byTestId(TID.snapshotRowRestore(_restoreSnapshotFilename)),
    { timeout: 30_000 },
  )
  expect(await popup.click(byTestId(TID.snapshotRowRestore(_restoreSnapshotFilename)))).toBe(true)

  // SnapshotsView builds a diff-preview confirm. When the snapshot's
  // change summary has lines (different pkgs / commit from the prior
  // snapshot), ModalDialog routes through the rich-confirm branch
  // with `TID.modalConfirm`. When the target snapshot is identical
  // to the prior one (e.g. a manual snapshot captured immediately
  // after the auto post-update snapshot at the same HEAD + pkg state),
  // `messageDetails` is undefined and ModalDialog falls back to the
  // BaseAlert simple-confirm path with `base-alert-action`. Accept
  // either CTA via a CSS comma selector.
  const confirmSelector =
    '[data-testid="modal-confirm-button"], [data-testid="base-alert-action"]'
  await popup.waitForVisible(confirmSelector, { timeout: 30_000 })
  expect(await popup.click(confirmSelector)).toBe(true)

  await waitForProgressTakeoverAfterPopupClose()

  // The picker owns the progress UI while main performs the stop and relaunch.
  await expect.poll(() => execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir, encoding: 'utf-8', windowsHide: true,
  }).trim(), { timeout: 540_000, intervals: [2_000, 5_000] }).not.toBe(rolledBack)
  await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000, 2_000] }).toBe(true)

  // Snapshot restore must leave the working tree on a valid commit.
  const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir, encoding: 'utf-8', windowsHide: true,
  }).trim()
  expect(headAfter).toMatch(/^[a-f0-9]{40}$/)

  // Restore runs the REAL pip-sync phase against this env (unlike the
  // snapshot-restore fixture spec) - it must never touch the torch
  // family either.
  expectTorchFamilyUnchanged('snapshot restore (incl. pip sync) changed the installed torch family')

  // Inline-picker routing keeps the popup open on its success screen;
  // close it so the next test's title-pill entry opens the picker
  // instead of toggling it shut.
  await closeTitlePopupIfOpen(ctx.app)
})

// ---------------------------------------------------------------------------
// Picker Restart — the pin-bottom primary CTA reads "Restart" when the
// selected install runs in the current window (`decideNavigation` cell
// (instance, instance, self)). Clicking it confirms in-drawer via the
// popup's DialogHost BaseAlert (`confirmLocalKill`), then fires
// `restartInstall(confirmed: true)` over the picker bridge — main's
// `restartInstallFromPicker` skips its system-modal safety net, runs
// `ipc.stopRunning`, and routes a `picker-pick-install` payload back to
// the panel for the re-launch.
//
// Note: this path intentionally bypasses the `stop-comfyui` IPC channel
// (it goes through `ipc.stopRunning` directly), so the per-channel
// invocation count for `stop-comfyui` stays at zero.
// ---------------------------------------------------------------------------

test('picker primary CTA Restart drives in-drawer confirm + re-launch @sec-picker @lifecycle', async () => {
  test.setTimeout(300_000)

  // The restore op ahead of us keeps its slot past the frontend-load
  // signal; the Restart CTA is inert while the picker shows the op.
  await waitForOperationDrain(_updateInstallId)

  await resetIpcInvocations(ctx.app, 'stop-comfyui')
  await resetIpcInvocations(ctx.app, 'run-action')

  // The restore's IN_PLACE_RELAUNCH registers the fresh session after
  // the frontend reloads - poll instead of a one-shot read so a slow
  // relaunch (hosted CI runners) cannot race this test's precondition.
  let beforeSnapshot: Awaited<ReturnType<typeof getRunningSessionSnapshot>> = null
  await expect
    .poll(async () => {
      beforeSnapshot = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
      return beforeSnapshot
    }, { timeout: 120_000, intervals: [1_000, 2_000] })
    .not.toBeNull()
  expect(beforeSnapshot, 'expected a running session before Restart').not.toBeNull()

  // Open the picker through the running host's title pill — it seeds
  // the running install so the detail pane (and its footer CTA)
  // targets it.
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar)

  await popup.waitForVisible(byTestId(TID.pickerPrimaryCta), { timeout: 15_000 })
  await expect
    .poll(() => popup.textOf(byTestId(TID.pickerPrimaryCta)), {
      timeout: 10_000, intervals: [200, 400],
    })
    .toContain('Restart')
  expect(await popup.click(byTestId(TID.pickerPrimaryCta))).toBe(true)

  // Local restarts confirm in-drawer — a BaseAlert inside the popup,
  // NOT the system modal (that's only main's safety net for unconfirmed
  // bridge calls, which the real UI never sends).
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)

  // Main hides the popup before firing `restartInstallFromPicker` so
  // the panel's ProgressModal lands unobstructed.
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 10_000, intervals: [100, 200],
    })
    .toBe(false)

  // The restart path tears down + re-launches comfy in place. Wait
  // for the launch leg to fire on the panel side (panel handles the
  // `picker-pick-install` overlay → `performPickerLaunch` →
  // `runAction(id, 'launch')`), then for the frontend to be live.
  await waitForRunAction(_updateInstallId, 'launch', { timeout: 180_000, intervals: [1_000, 2_000] })
  await expect
    .poll(async () => {
      const after = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
      if (!after) return false
      return after.startedAt > (beforeSnapshot?.startedAt ?? 0)
    }, { timeout: 180_000, intervals: [1_000, 2_000] })
    .toBe(true)
  await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000] }).toBe(true)

  // The picker Restart deliberately bypasses the `stop-comfyui`
  // renderer IPC (main uses `ipc.stopRunning` directly), so no
  // invocations should land on that channel.
  const stopCalls = await getStopsFor(_updateInstallId)
  expect(stopCalls.length, 'picker Restart should bypass the stop-comfyui renderer IPC').toBe(0)

  const launchCalls = (await getRunActionsFor(_updateInstallId))
    .filter((c) => c.actionId === 'launch')
  expect(launchCalls.length, 'exactly one launch run-action for the restart').toBeGreaterThanOrEqual(1)
})

// ---------------------------------------------------------------------------
// Picker Stop + relaunch — the footer "More" menu surfaces a synthetic
// Stop item for a running local install (`useComfyUISettings`
// `pinBottomActions`; `launch`/`restart` are filtered out because the
// primary CTA owns them). Stop confirms via the popup's DialogHost
// BaseAlert, then fires the renderer `stop-comfyui` IPC
// (`confirmAndStop` → `window.api.stopComfyUI`) — the key contrast with
// the picker Restart above, which bypasses that channel. On success the
// drawer dismisses and the host window shows its stopped card; the test
// then relaunches through the stopped card's Relaunch button to hand a
// running install to the tests downstream.
// ---------------------------------------------------------------------------

test('picker More-menu Stop fires stop-comfyui; stopped-card Relaunch restores it @sec-picker @lifecycle', async () => {
  test.setTimeout(300_000)

  // Sanity: the prior Restart test left ComfyUI running.
  await expect.poll(comfyFrontendIsLoaded, { timeout: 30_000, intervals: [500] }).toBe(true)
  const beforeSnapshot = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
  expect(beforeSnapshot, 'expected a running session before Stop').not.toBeNull()

  await resetIpcInvocations(ctx.app, 'stop-comfyui')
  await resetIpcInvocations(ctx.app, 'run-action')

  // Real entry: running host title pill -> picker Config tab.
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'config')

  await popup.waitForVisible(byTestId(TID.pickerMoreTrigger), { timeout: 15_000 })
  await popup.clickUntilVisible(byTestId(TID.pickerMoreTrigger), byTestId(TID.pinBottomAction('stop')), { timeout: 30_000 })
  // The primary CTA owns launch/restart; neither may leak into the menu.
  expect(await popup.exists(byTestId(TID.pinBottomAction('launch'))), 'launch must not render in the More menu').toBe(false)
  expect(await popup.exists(byTestId(TID.pinBottomAction('restart'))), 'restart must not render in the More menu').toBe(false)
  expect(await popup.click(byTestId(TID.pinBottomAction('stop')))).toBe(true)

  // Danger confirm renders in the popup's DialogHost BaseAlert.
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)

  // `confirmAndStop` fires the renderer `stop-comfyui` IPC, and the
  // session must actually die (frontend gone, session snapshot null).
  await expect
    .poll(async () => (await getStopsFor(_updateInstallId)).length, {
      timeout: 60_000, intervals: [500, 1_000],
    })
    .toBeGreaterThanOrEqual(1)
  await expect
    .poll(async () => getRunningSessionSnapshot(ctx.app, _updateInstallId), {
      timeout: 120_000, intervals: [1_000, 2_000],
    })
    .toBeNull()
  // Stopping deliberately preserves the host window and hides the dead
  // frontend view behind the lifecycle panel (`refreshComfyTabBody` swaps
  // the body to 'comfy-lifecycle'); the localhost webContents stays
  // loaded, so assert the visible stopped card rather than view teardown.
  await ctx.panel.waitForVisible('.panel-comfy-lifecycle', { timeout: 30_000 })

  // A successful stop dismisses the drawer (`onDismissPreview` →
  // request-dismiss) so the window shows its stopped card.
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 10_000, intervals: [100, 200],
    })
    .toBe(false)

  // Relaunch through the stopped card's Relaunch button — the natural
  // user flow after a stop. (The picker primary CTA is a dead end here:
  // for the host's own stopped install it reads "Switch" and
  // `pickInstallFromPicker` early-returns on
  // `parentEntry.installationId === installationId`, so it never
  // relaunches — product quirk worth revisiting.)
  // Generous timeout: the renderer stays in 'stopping' (spinner placeholder)
  // until the Windows process tree fully dies, which can lag the main-side
  // session-record clear (asserted above) by tens of seconds. Note the card
  // teleports to body via `BrandTakeoverLayout`, so the button is NOT a
  // descendant of `.lifecycle-view` — hence the dedicated testid.
  await ctx.panel.waitForVisible(byTestId(TID.lifecycleRelaunch), { timeout: 120_000 })
  expect(await ctx.panel.click(byTestId(TID.lifecycleRelaunch))).toBe(true)

  await waitForRunAction(_updateInstallId, 'launch', { timeout: 180_000, intervals: [1_000, 2_000] })
  await expect
    .poll(async () => {
      const after = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
      if (!after) return false
      return after.startedAt > (beforeSnapshot?.startedAt ?? 0)
    }, { timeout: 180_000, intervals: [1_000, 2_000] })
    .toBe(true)
  await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000] }).toBe(true)
  await closeTitlePopupIfOpen(ctx.app)
})

// ---------------------------------------------------------------------------
// Boot-window settings edits (issue #1300) + restart-during-boot.
//
// The spawned ComfyUI process consumes its launch configuration at spawn,
// so an edit made while it boots (spawn -> port-ready) is not reflected in
// that process. Two real-process regressions, using --port as the queryable
// startup argument (the relaunched server must answer on the edited port):
//
// 1. An edit during the boot window surfaces "Restart to apply changes"
//    once the instance is running, and the CTA restart actually applies it.
// 2. A restart clicked while STILL booting cancels the in-flight boot and
//    relaunches on the edited config. This used to be a silent no-op:
//    `stopRunning` had no registered session to stop and the relaunch was
//    rejected by the in-flight-operation guard.
// ---------------------------------------------------------------------------

/** A currently-free loopback TCP port, probed from the test process. Both
 *  probe ranges sit far above the launcher's 8188..+1000 conflict-retry
 *  range, so a dynamically-picked port can never collide by chance. */
async function findFreeLoopbackPort(start: number): Promise<number> {
  for (let port = start; port < start + 200; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer()
      srv.once('error', () => resolve(false))
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)))
    })
    if (free) return port
  }
  throw new Error(`no free loopback port found in [${start}, ${start + 200})`)
}

/** The persisted launchArgs string for the suite's install, straight from
 *  the installations record. */
function readRecordLaunchArgs(): Promise<string> {
  return ctx.panel.evaluate<string>(
    `window.api.getInstallations().then((list) => {
      const inst = list.find((i) => i.id === ${JSON.stringify(_updateInstallId)})
      return (inst && inst.launchArgs) || ''
    })`,
  )
}

/** Set `--port <port>` in the Startup Args raw input of the OPEN picker
 *  popup (config tab) through the real input pipeline, replacing any prior
 *  --port. The raw input commits on the native change event, so the edit is
 *  committed by blurring, then confirmed against the persisted record. */
async function setPortArgViaPicker(popup: WebContentsPage, port: number): Promise<void> {
  const rawSel = '.args-raw-input input'
  await popup.waitForVisible(rawSel, { timeout: 15_000 })
  const before = await popup.evaluate<string>(
    `document.querySelector(${JSON.stringify(rawSel)}).value`,
  )
  const withoutPort = before.replace(/--port(?:[ =]\S+)?/g, ' ').replace(/\s+/g, ' ').trim()
  await popup.fill(rawSel, `${withoutPort} --port ${port}`.trim())
  await popup.evaluate<boolean>(
    `(() => { document.querySelector(${JSON.stringify(rawSel)}).blur(); return true })()`,
  )
  await expect
    .poll(readRecordLaunchArgs, { timeout: 10_000, intervals: [100, 250] })
    .toContain(`--port ${port}`)
}

/** Drive the open picker's primary CTA through its in-drawer confirm and
 *  wait for main to hide the popup (it does so before firing the restart). */
async function confirmPickerRestart(popup: WebContentsPage): Promise<void> {
  await popup.waitForVisible(byTestId(TID.pickerPrimaryCta), { timeout: 15_000 })
  expect(await popup.click(byTestId(TID.pickerPrimaryCta))).toBe(true)
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 10_000, intervals: [100, 200],
    })
    .toBe(false)
}

/** Restart the running install via the picker CTA and wait for the boot
 *  window to open: no registered session, launch operation armed. */
async function openBootWindowViaPickerRestart(): Promise<void> {
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar)
  await confirmPickerRestart(popup)
  // One combined predicate: the boot window is open when the old session is
  // gone AND the relaunch operation is active. Two sequential polls would be
  // order-dependent - a relaunch that registers before the second poll starts
  // sampling could never be observed and would burn the full timeout.
  await expect
    .poll(async () => {
      const [session, active] = await Promise.all([
        getRunningSessionSnapshot(ctx.app, _updateInstallId),
        hasActiveOperation(ctx.app, _updateInstallId),
      ])
      return session === null && active
    }, { timeout: 60_000, intervals: [250, 500] })
    .toBe(true)
}

test('boot-window --port edit surfaces Restart-to-apply and the restart applies it @sec-bootwindow @lifecycle', async () => {
  test.setTimeout(600_000)
  await waitForOperationDrain(_updateInstallId)

  let before: Awaited<ReturnType<typeof getRunningSessionSnapshot>> = null
  await expect
    .poll(async () => {
      before = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
      return before
    }, { timeout: 120_000, intervals: [1_000, 2_000] })
    .not.toBeNull()
  const targetPort = await findFreeLoopbackPort(19100)
  expect(targetPort, 'target port must differ from the current one').not.toBe(before!.port)

  // Restart through the real picker CTA to open a boot window, then edit
  // the args MID-BOOT through the picker's Startup Args raw input.
  await openBootWindowViaPickerRestart()
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'config')
  await setPortArgViaPicker(popup, targetPort)

  // The edit only proves anything if it landed inside the boot window -
  // boots take tens of seconds, the UI edit a couple. Fail loudly if not.
  expect(
    await getRunningSessionSnapshot(ctx.app, _updateInstallId),
    'boot completed before the boot-window edit landed - cannot exercise issue #1300',
  ).toBeNull()

  // The in-flight boot consumed its pre-edit config: it must come up on a
  // port that is NOT the just-persisted target...
  let booted: Awaited<ReturnType<typeof getRunningSessionSnapshot>> = null
  await expect
    .poll(async () => {
      booted = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
      return booted
    }, { timeout: 300_000, intervals: [1_000, 2_000] })
    .not.toBeNull()
  expect(
    booted!.port,
    'the in-flight boot must come up on the pre-edit port, not pick up an edit made after it spawned',
  ).toBe(before!.port)

  // ...and the popup (kept open across the boot - pending-restart state is
  // renderer-local) must flip its CTA to "Restart to apply changes".
  await expect
    .poll(() => popup.textOf(byTestId(TID.pickerPrimaryCta)), {
      timeout: 30_000, intervals: [250, 500],
    })
    .toContain('Restart to apply')

  // Restart through the CTA: the relaunch must ACTUALLY apply the edit.
  await confirmPickerRestart(popup)
  await expect
    .poll(async () => {
      const after = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
      if (!after || after.startedAt <= booted!.startedAt) return null
      return after.port
    }, { timeout: 300_000, intervals: [1_000, 2_000] })
    .toBe(targetPort)

  // The queryable proof against the live server, not just the session record.
  await expect
    .poll(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${targetPort}/system_stats`, {
          signal: AbortSignal.timeout(5_000),
        })
        return res.status
      } catch { return 0 }
    }, { timeout: 60_000, intervals: [1_000] })
    .toBe(200)
  await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000] }).toBe(true)
  await closeTitlePopupIfOpen(ctx.app)
})

test('restart clicked during boot cancels the in-flight boot and applies the edited --port @sec-bootwindow @lifecycle', async () => {
  test.setTimeout(600_000)
  await waitForOperationDrain(_updateInstallId)

  await expect
    .poll(async () => getRunningSessionSnapshot(ctx.app, _updateInstallId), {
      timeout: 120_000, intervals: [1_000, 2_000],
    })
    .not.toBeNull()
  // A different probe range than the sibling test above, so this target
  // can never equal the port the install is currently running on.
  const targetPort = await findFreeLoopbackPort(19400)

  // Boot window + mid-boot edit, as above.
  await openBootWindowViaPickerRestart()
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'config')
  await setPortArgViaPicker(popup, targetPort)
  expect(
    await getRunningSessionSnapshot(ctx.app, _updateInstallId),
    'boot completed before the boot-window edit landed - cannot exercise restart-during-boot',
  ).toBeNull()

  // THE regression: restart while STILL booting. Pre-fix this was a silent
  // no-op (no session for stopRunning; relaunch rejected by the in-flight
  // guard) and the instance came up on the stale pre-edit config. The CTA
  // and in-drawer confirm are clicked inline (not via confirmPickerRestart)
  // so the boot window can be proven open right before the confirm click -
  // otherwise a fast boot would silently degrade this into an ordinary
  // running restart that passes without exercising the cancellation path.
  await popup.waitForVisible(byTestId(TID.pickerPrimaryCta), { timeout: 15_000 })
  expect(await popup.click(byTestId(TID.pickerPrimaryCta))).toBe(true)
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(
    await isInstallLaunching(ctx.app, _updateInstallId),
    'boot finished before the restart click - this run did not exercise restart-during-boot',
  ).toBe(true)
  expect(await getRunningSessionSnapshot(ctx.app, _updateInstallId)).toBeNull()
  await resetIpcInvocations(ctx.app, 'picker-restart:cancel-launching')
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 10_000, intervals: [100, 200],
    })
    .toBe(false)

  // Decisive proof the boot-window path ran: main's restart handler must
  // report the in-flight launch was actually cancelled. `cancelled: false`
  // means the boot finished before the click landed and this run silently
  // exercised the ordinary running-restart path instead.
  await expect
    .poll(async () => {
      const calls = (await getIpcInvocations(ctx.app, 'picker-restart:cancel-launching')) as
        Array<{ installationId?: string; cancelled?: boolean }>
      return calls.find((c) => c.installationId === _updateInstallId)?.cancelled ?? null
      // Must exceed cancelLaunching's own 60s deadline: the invocation is
      // only recorded once that call resolves, and a slow-but-successful
      // Windows process-tree kill can use most of it.
    }, { timeout: 90_000, intervals: [250, 500] })
    .toBe(true)

  // The cancelled boot never registers; the relaunch must come up on the
  // edited port. If the cancel regressed into a no-op, the surviving boot
  // registers on the pre-edit port and this poll times out on it.
  await expect
    .poll(async () => {
      const after = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
      return after?.port ?? null
    }, { timeout: 300_000, intervals: [1_000, 2_000] })
    .toBe(targetPort)
  await expect
    .poll(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${targetPort}/system_stats`, {
          signal: AbortSignal.timeout(5_000),
        })
        return res.status
      } catch { return 0 }
    }, { timeout: 60_000, intervals: [1_000] })
    .toBe(200)
  await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000] }).toBe(true)
  await closeTitlePopupIfOpen(ctx.app)
})

test('restart clicked during a FRESH chooser boot (unattached window) cancels it and applies the edited --port @sec-bootwindow @lifecycle', async () => {
  test.setTimeout(600_000)
  await waitForOperationDrain(_updateInstallId)

  // Fresh-boot precondition: stop and return to the chooser, so the next
  // launch comes from an UNATTACHED chooser host. `attachInstall` only sets
  // `entry.installationId` at port-ready, so for the whole boot the window
  // carries nothing but the chooser's staked `previewInstallationId` - the
  // exact state in which main's restart identity guard used to discard the
  // IPC, making restart-during-first-boot a silent no-op. (The sibling tests
  // above restart an already-ATTACHED window, so they can never catch this.)
  await stopAndReturnToDashboardViaUI()

  const targetPort = await findFreeLoopbackPort(19700)
  // The port the in-flight boot would come up on (persisted by the sibling
  // test's edit) - must differ from the target so "the relaunch applied the
  // mid-boot edit" is distinguishable from "the old boot survived".
  const staleArgs = await readRecordLaunchArgs()
  const staleMatch = /--port[ =](\d+)/.exec(staleArgs)
  expect(staleMatch, `expected a persisted --port in launchArgs (got "${staleArgs}")`).not.toBeNull()
  const stalePort = Number(staleMatch![1])
  expect(stalePort).not.toBe(targetPort)

  try {
    // Park the NEXT launch at the spawn hold (launching marker set, port
    // reserved, no process yet), then launch through the real chooser tile.
    // The hold makes the boot window deterministic - every step below lands
    // inside it by construction instead of racing real boot speed.
    await armLaunchSpawnHold(ctx.app)
    await clickInstallTile(ctx.panel, 'ComfyUI')
    await expect
      .poll(() => isLaunchSpawnHeld(ctx.app), { timeout: 120_000, intervals: [250, 500] })
      .toBe(true)
    expect(await hasActiveLaunch(ctx.app, _updateInstallId)).toBe(true)
    expect(await isInstallLaunching(ctx.app, _updateInstallId)).toBe(true)
    expect(await getRunningSessionSnapshot(ctx.app, _updateInstallId)).toBeNull()

    // Mid-boot --port edit through the real picker, opened from the pill of
    // the booting, preview-attached window.
    const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'config')
    await setPortArgViaPicker(popup, targetPort)

    // The CTA must offer Restart even though the window is only preview-
    // attached (`useInstallCta` folds the preview claim into the active id).
    await expect
      .poll(() => popup.textOf(byTestId(TID.pickerPrimaryCta)), {
        timeout: 15_000, intervals: [250, 500],
      })
      .toContain('Restart')

    await resetIpcInvocations(ctx.app, 'picker-restart:cancel-launching')
    expect(await popup.click(byTestId(TID.pickerPrimaryCta))).toBe(true)
    await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
    // Still parked: the confirm below provably lands inside the boot window.
    expect(await isLaunchSpawnHeld(ctx.app)).toBe(true)
    expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)
    await expect
      .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
        timeout: 10_000, intervals: [100, 200],
      })
      .toBe(false)

    // Decisive main-side proof: the restart handler accepted the preview-
    // attached window AND cancelled the in-flight launch. Pre-fix, the
    // identity guard returned before cancelLaunching, so this channel
    // recorded no invocation at all and this poll times out.
    await expect
      .poll(async () => {
        const calls = (await getIpcInvocations(ctx.app, 'picker-restart:cancel-launching')) as
          Array<{ installationId?: string; cancelled?: boolean }>
        return calls.find((c) => c.installationId === _updateInstallId)?.cancelled ?? null
        // Headroom past cancelLaunching's own 60s deadline (see the
        // attached-window variant above).
      }, { timeout: 90_000, intervals: [250, 500] })
      .toBe(true)
    // The cancel must have released the hold through the launch's abort
    // signal - the parked boot unwound instead of proceeding to spawn.
    await expect
      .poll(() => isLaunchSpawnHeld(ctx.app), { timeout: 10_000, intervals: [100, 250] })
      .toBe(false)

    // The relaunch is a REAL boot and must come up on the edited port.
    await expect
      .poll(async () => {
        const after = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
        return after?.port ?? null
      }, { timeout: 300_000, intervals: [1_000, 2_000] })
      .toBe(targetPort)
    await expect
      .poll(async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${targetPort}/system_stats`, {
            signal: AbortSignal.timeout(5_000),
          })
          return res.status
        } catch { return 0 }
      }, { timeout: 60_000, intervals: [1_000] })
      .toBe(200)
    // The cancelled boot never spawned, so nothing may serve the stale port.
    await expect(
      fetch(`http://127.0.0.1:${stalePort}/system_stats`, { signal: AbortSignal.timeout(3_000) }),
    ).rejects.toThrow()
    await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000] }).toBe(true)
    await closeTitlePopupIfOpen(ctx.app)
  } finally {
    // Idempotent; a failed assertion must not leave a launch parked forever.
    await releaseLaunchSpawnHold(ctx.app)
  }
})

// ---------------------------------------------------------------------------
// FLOW 2 — real copy via the picker's pin-bottom MoreMenu.
//
// `copy` is REQUIRES_STOPPED + a runAction prompt chain. The picker's
// footer "More" menu → Copy item exercises the full prompt →
// showProgress → real ~500MB filesystem copy path. (The dashboard
// kebab → Copy Installation path is covered separately further down.)
// ---------------------------------------------------------------------------

let _copyInstallId = ''
let _copyInstallPath = ''

test('picker pin-bottom Copy creates a real ~500MB copy of the install @sec-copy @lifecycle', async () => {
  test.setTimeout(600_000)

  // Copy is REQUIRES_STOPPED — stop comfy through the real UI (pill ->
  // picker Stop -> confirm -> stopped card -> Return to Dashboard) so
  // the IPC handler doesn't bail and the picker dispatches without a
  // self-stop preamble.
  await stopAndReturnToDashboardViaUI()

  // Real entry: dashboard tile kebab -> Manage.
  const popup = await openManageViaDashboard(ctx.app, ctx.panel, _updateInstallId, 'config')

  // Open the footer "More" overflow menu → click Copy. (`[data-more-trigger]`
  // also matches the window-options caret, so target the explicit test id.)
  await popup.waitForVisible(byTestId(TID.pickerMoreTrigger), { timeout: 15_000 })
  await popup.clickUntilVisible(byTestId(TID.pickerMoreTrigger), byTestId(TID.pinBottomAction('copy')), { timeout: 30_000 })
  expect(await popup.click(byTestId(TID.pinBottomAction('copy')))).toBe(true)

  // Prompt for the copy's new name. The picker drives dialogs through
  // `useDialogs` → DialogHost → BasePrompt, so the surface carries the
  // base-prompt test ids (not ModalDialog's modal-prompt ones).
  // Random suffix so a reused profile carrying a same-named copy from an
  // aborted prior run can't satisfy `waitForCopyRegistered` vacuously.
  const newName = `ComfyUI Copy E2E ${randomUUID().slice(0, 8)}`
  await submitCopyNamePrompt(popup, newName)

  await waitForProgressTakeoverAfterPopupClose()

  // The picker routes copy 'inline-picker' (`resolveProgressRouting`):
  // the op renders in the picker's right pane and its success screen
  // auto-dismisses after a countdown — no window is opened for the new
  // install.
  const copyRecord = await waitForCopyRegistered(newName)
  _copyInstallId = copyRecord.id
  _copyInstallPath = copyRecord.installPath
  _runCreatedInstallPaths.add(_copyInstallPath)
  await waitForOperationDrain(_updateInstallId)

  // Disk shape: copy is a full standalone tree (ComfyUI/.git +
  // standalone-env + marker), and the source dir is untouched.
  expect(existsSync(path.join(_copyInstallPath, 'ComfyUI', '.git')), 'copy missing ComfyUI/.git').toBe(true)
  expect(existsSync(path.join(_copyInstallPath, 'standalone-env')), 'copy missing standalone-env/').toBe(true)
  expect(existsSync(path.join(_copyInstallPath, '.comfyui-desktop-2')), 'copy missing .comfyui-desktop-2 marker').toBe(true)
  expect(existsSync(path.join(_updateInstallPath, 'ComfyUI', '.git')), 'source ComfyUI/.git missing after copy').toBe(true)
  expect(existsSync(path.join(_updateInstallPath, '.comfyui-desktop-2')), 'source marker missing after copy').toBe(true)

  // The picker stays open on/after its success screen; close it so
  // subsequent dashboard-driven tests start from a clean panel.
  await closeTitlePopupIfOpen(ctx.app)
})

test('cleans up the copy install before the original delete test runs @sec-copy @lifecycle', async () => {
  test.setTimeout(300_000)
  expect(_copyInstallId, 'no copy install id captured to clean up').toBeTruthy()

  // Real delete flow on the copy's dashboard tile: kebab -> Delete ->
  // BaseAlert confirm. The copy is stopped (never launched), so no
  // `stop-comfyui` preamble is needed. Frees disk before the existing
  // final delete test runs against the original.
  await expectChooserVisible(ctx.panel)
  await ctx.panel.waitForVisible(byTestId(TID.dashboardTileKebab(_copyInstallId)), { timeout: 15_000 })
  expect(await ctx.panel.click(byTestId(TID.dashboardTileKebab(_copyInstallId)))).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.contextMenuItem('delete')), { timeout: 5_000 })
  expect(await ctx.panel.click(byTestId(TID.contextMenuItem('delete')))).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 15_000 })
  expect(await ctx.panel.click(byTestId(TID.baseAlertAction))).toBe(true)

  // The full-tree recursive rm runs async behind the confirm.
  await expect
    .poll(() => existsSync(_copyInstallPath), { timeout: 240_000, intervals: [1_000, 2_000] })
    .toBe(false)
  await expect
    .poll(async () => {
      const remaining = await ctx.panel.evaluate<InstallationLite[]>(`window.api.getInstallations()`)
      return remaining.some((i) => i.id === _copyInstallId)
    }, { timeout: 30_000, intervals: [250, 500] })
    .toBe(false)
  const remaining = await ctx.panel.evaluate<InstallationLite[]>(`window.api.getInstallations()`)
  expect(remaining.find((i) => i.id === _updateInstallId), 'original install was unexpectedly removed').toBeDefined()
})

// ---------------------------------------------------------------------------
// Dashboard kebab "Copy Installation" / "Untrack" — both route through
// `opts.onManage(inst, { autoAction })` so the picker opens in
// expanded mode with the autoAction seed and `ComfyUISettingsContent`
// fires the action through the full `useComfyUISettings.runAction`
// chain (prompt → disk-check → showProgress for copy; confirm → inline
// runAction for remove).
//
// One fresh ~500MB kebab-driven copy is the target for both tests
// (kebab Copy on the original → kebab Untrack on the new copy) so the
// registry-only Untrack semantics can be validated without breaking
// the original-install state the final Delete test depends on. The
// kebab-copy's on-disk tree is then `fs.rm`'d manually to reclaim the
// ~500MB before the final Delete test runs.
// ---------------------------------------------------------------------------

let _kebabCopyInstallId = ''
let _kebabCopyInstallPath = ''

test('dashboard kebab "Copy Installation" creates a real ~500MB copy @sec-copy @lifecycle', async () => {
  test.setTimeout(600_000)

  // The prior cleanup test ran direct `runAction('delete')` against
  // the previous picker-copy and ComfyUI is stopped from earlier; the
  // chooser is already visible. Sanity-check the kebab is available
  // on the seeded tile before driving the menu.
  await expectChooserVisible(ctx.panel)
  await ctx.panel.waitForVisible(byTestId(TID.dashboardTileKebab(_updateInstallId)), { timeout: 10_000 })

  // The ≤1-dispatch regression assertion below needs a clean slate.
  await resetIpcInvocations(ctx.app, 'run-action')

  // Open the dashboard kebab on the original install tile and click
  // the Copy Installation item — the composable routes this to
  // `opts.onManage(inst, { autoAction: 'copy' })` which expands the
  // picker on the Config tab with the autoAction seed.
  expect(await ctx.panel.click(byTestId(TID.dashboardTileKebab(_updateInstallId)))).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.contextMenuItem('copy-install')), { timeout: 5_000 })
  expect(await ctx.panel.click(byTestId(TID.contextMenuItem('copy-install')))).toBe(true)

  // Picker mounts in expanded mode with autoAction='copy' →
  // ComfyUISettingsContent fires `runAction('copy')` → renderer-side
  // prompt for the new install name (BasePrompt via useDialogs).
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  // Random suffix: see the picker-copy test above.
  const newName = `ComfyUI Kebab Copy E2E ${randomUUID().slice(0, 8)}`
  await submitCopyNamePrompt(popup, newName)

  // Copy op renders inline in the picker's right pane (same
  // 'inline-picker' routing as the pin-bottom Copy above).
  await waitForProgressTakeoverAfterPopupClose()

  const copyRecord = await waitForCopyRegistered(newName)
  _kebabCopyInstallId = copyRecord.id
  _kebabCopyInstallPath = copyRecord.installPath
  _runCreatedInstallPaths.add(_kebabCopyInstallPath)
  await waitForOperationDrain(_updateInstallId)

  // Disk shape: kebab copy materializes the same standalone tree the
  // picker pin-bottom Copy did, and the source tree is unchanged.
  expect(existsSync(path.join(_kebabCopyInstallPath, 'ComfyUI', '.git')), 'kebab copy missing ComfyUI/.git').toBe(true)
  expect(existsSync(path.join(_kebabCopyInstallPath, 'standalone-env')), 'kebab copy missing standalone-env/').toBe(true)
  expect(existsSync(path.join(_kebabCopyInstallPath, '.comfyui-desktop-2')), 'kebab copy missing .comfyui-desktop-2 marker').toBe(true)
  expect(existsSync(path.join(_updateInstallPath, 'ComfyUI', '.git')), 'source ComfyUI/.git missing after kebab copy').toBe(true)
  expect(existsSync(path.join(_updateInstallPath, '.comfyui-desktop-2')), 'source marker missing after kebab copy').toBe(true)

  // Critical assertion for the regression: the kebab dispatch must
  // NOT have fired a `runAction('copy')` IPC directly from the
  // dashboard — it has to go through the picker autoAction route so
  // the prompt is collected. Direct dispatch would carry no
  // `actionData` and main would return `{ ok: false }` silently.
  const runActions = await getRunActionsFor(_updateInstallId)
  const copyDispatches = runActions.filter((c) => c.actionId === 'copy')
  expect(copyDispatches.length, 'kebab dispatch must route copy through the picker, not call runAction directly').toBeLessThanOrEqual(1)

  // The picker stays open on/after its success screen; close it so the
  // Untrack test below starts from a clean dashboard.
  await closeTitlePopupIfOpen(ctx.app)
})

test('dashboard kebab "Untrack" removes the install from the registry without touching disk @sec-copy @lifecycle', async () => {
  test.setTimeout(60_000)
  expect(_kebabCopyInstallId, 'no kebab-copy install id to untrack').toBeTruthy()
  expect(_kebabCopyInstallPath, 'no kebab-copy install path captured').toBeTruthy()

  // Dashboard should be visible again on the panel and show BOTH the
  // original tile and the kebab-copy tile.
  await waitForWebContents(ctx.app, 'panel.html')
  await expectChooserVisible(ctx.panel)
  await ctx.panel.waitForVisible(byTestId(TID.dashboardTileKebab(_kebabCopyInstallId)), { timeout: 10_000 })

  // Click the kebab on the kebab-copy tile (NOT the original — the
  // original needs to survive for the final Delete test).
  expect(await ctx.panel.click(byTestId(TID.dashboardTileKebab(_kebabCopyInstallId)))).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.contextMenuItem('untrack')), { timeout: 5_000 })
  expect(await ctx.panel.click(byTestId(TID.contextMenuItem('untrack')))).toBe(true)

  // The Untrack item confirms in the dashboard's own renderer:
  // `useInstallContextMenu` runs `modal.confirm(...)` — a simple confirm,
  // which ModalDialog routes through BaseAlert in panel.html — then
  // dispatches `runAction('remove')` directly. No picker is involved.
  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 15_000 })
  expect(await ctx.panel.click(byTestId(TID.baseAlertAction))).toBe(true)

  // Poll the registry until the kebab-copy id is gone.
  await expect
    .poll(
      async () => {
        const installs = await ctx.panel.evaluate<InstallationLite[]>(`window.api.getInstallations()`)
        return installs.some((i) => i.id === _kebabCopyInstallId)
      },
      { timeout: 30_000, intervals: [250, 500] },
    )
    .toBe(false)

  // Critical Untrack semantics: registry entry gone, disk preserved.
  // (Delete is the destructive counterpart — this is the difference.)
  expect(existsSync(_kebabCopyInstallPath), 'untrack must NOT touch disk; kebab-copy dir should still exist').toBe(true)
  expect(
    existsSync(path.join(_kebabCopyInstallPath, '.comfyui-desktop-2')),
    'untrack must leave marker file intact on disk',
  ).toBe(true)

  // Original install untouched.
  const remaining = await ctx.panel.evaluate<InstallationLite[]>(`window.api.getInstallations()`)
  expect(remaining.find((i) => i.id === _updateInstallId), 'untrack must not affect the original install').toBeDefined()
})

test('cleans up the untracked kebab-copy on disk before the final Delete test runs @sec-copy @lifecycle', async () => {
  test.setTimeout(120_000)
  expect(_kebabCopyInstallPath, 'no kebab-copy install path to clean up').toBeTruthy()
  expect(existsSync(_kebabCopyInstallPath), 'kebab-copy dir already gone — Untrack test invariant violated').toBe(true)

  // Untrack intentionally leaves the ~500MB tree on disk; the test
  // suite has to free it before the final fully-installed Delete test
  // runs so the harness home temp dir doesn't carry a stale copy.
  // Same `fs.rm` semantics the main-side delete handler uses; run from
  // the test process directly (the path lives on the harness home temp
  // dir and is readable by both processes).
  rmSync(_kebabCopyInstallPath, { recursive: true, force: true })

  await expect
    .poll(() => existsSync(_kebabCopyInstallPath), { timeout: 60_000, intervals: [500, 1_000] })
    .toBe(false)
})

// ---------------------------------------------------------------------------
// Stop + Delete — real fs cleanup of a fully-installed standalone tree
// (~500MB on disk: ComfyUI/.git + standalone-env/ + ComfyUI/.venv).
//
// Validates the delete handler's marker-file safety check + recursive
// `fs.rm` against an install that actually has the contents users care
// about losing — including the Windows .venv where in-use file locks can
// make recursive deletion fight back.
//
// Note on the missing "close-window stops comfy" test: that path is now
// covered implicitly by the return-to-dashboard stop test above (same
// `detachInstall` teardown). We drop the explicit `win.close()` variant
// here because it always quits the app (closes the only host window),
// which would prevent the delete IPC below from running.
// ---------------------------------------------------------------------------

let _deleteInstallId = ''
let _deleteInstallPath = ''

test('stops comfy and captures the installed dir state before driving delete @sec-delete @lifecycle', async () => {
  // delete is in REQUIRES_STOPPED — stop comfy through the real UI
  // (pill -> picker Stop -> confirm -> stopped card -> Return to
  // Dashboard) so the IPC handler doesn't bail on us. The return
  // preserves the chooser host so we still have an IPC target for
  // delete + getInstallations.
  await stopAndReturnToDashboardViaUI()

  const installs = await ctx.panel.evaluate<InstallationLite[]>(`window.api.getInstallations()`)
  expect(installs.length, 'no tracked installation after install').toBeGreaterThan(0)
  const inst = installs[0]!
  _deleteInstallId = inst.id
  _deleteInstallPath = inst.installPath

  // Sanity: this should be a fully-installed standalone tree, not the
  // empty placeholder dirs the lifecycle-delete-untrack test uses. The
  // install dir is on the same filesystem the test runs on (the harness
  // home temp dir), so we can stat it directly from the test process.
  expect(existsSync(path.join(_deleteInstallPath, 'ComfyUI', '.git')), 'installed dir missing ComfyUI/.git').toBe(true)
  expect(existsSync(path.join(_deleteInstallPath, 'standalone-env')), 'installed dir missing standalone-env/').toBe(true)
  expect(existsSync(path.join(_deleteInstallPath, '.comfyui-desktop-2')), 'installed dir missing .comfyui-desktop-2 marker').toBe(true)
})

test('real delete wipes the fully-installed ~500MB tree off disk @sec-delete @lifecycle', async () => {
  // Recursive delete of a full standalone install can take a while on
  // Windows when files are large (the .venv ships thousands of small
  // files plus a few hundred-MB torch wheels). Stretch the timeout.
  test.setTimeout(300_000)
  expect(_deleteInstallPath, 'install path not captured').toBeTruthy()

  // Drive the real chooser flow: tile kebab → Delete → BaseAlert confirm
  // (same path dashboard-delete-flow.test.ts covers for a seeded install).
  await ctx.panel.waitForVisible(byTestId(TID.dashboardTileKebab(_deleteInstallId)), { timeout: 10_000 })
  expect(await ctx.panel.click(byTestId(TID.dashboardTileKebab(_deleteInstallId)))).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.contextMenuItem('delete')), { timeout: 5_000 })
  expect(await ctx.panel.click(byTestId(TID.contextMenuItem('delete')))).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 15_000 })
  expect(await ctx.panel.click(byTestId(TID.baseAlertAction))).toBe(true)

  // Disk verification — the entire install tree must be gone, not just
  // a few top-level entries. Probes both the root + a deep file the
  // standalone install always materializes (ComfyUI/main.py).
  await expect
    .poll(() => existsSync(_deleteInstallPath), { timeout: 240_000, intervals: [1_000, 2_000] })
    .toBe(false)
  expect(existsSync(path.join(_deleteInstallPath, 'ComfyUI', 'main.py')), 'ComfyUI/main.py still on disk after delete').toBe(false)

  // The installation record must also be gone.
  await expect
    .poll(async () => {
      const remaining = await ctx.panel.evaluate<InstallationLite[]>(`window.api.getInstallations()`)
      return remaining.some((i) => i.id === _deleteInstallId)
    }, { timeout: 30_000, intervals: [250, 500] })
    .toBe(false)
})
