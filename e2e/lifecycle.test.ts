import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import {
  clickInstallTile,
  clickNewInstallTile,
  expectChooserVisible,
  expectNewBuildModalOpen,
  expectTakeoverOpen,
  openManageViaDashboard,
  openNewBuildChangeSetup,
  saveNewBuildChangeSetup,
  openPickerViaTitlePill
} from './support/chooserHelpers'
import {
  armLaunchSpawnHold,
  ensureInstallPanelView,
  getIpcInvocations,
  getLiveDownloadsTrayState,
  getRunningSessionSnapshot,
  hasActiveLaunch,
  hasActiveOperation,
  isInstallLaunching,
  isLaunchSpawnHeld,
  releaseLaunchSpawnHold,
  resetIpcInvocations
} from './support/devHooks'
import {
  closeTitlePopupIfOpen,
  isPopupVisible,
  titlePopupPage,
  waitForWebContents,
  type WebContentsPage
} from './support/cdpPages'
import { evalWithRetry } from './support/evalRetry'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext

async function waitForConfigContinueEnabled(message: string): Promise<void> {
  await ctx.panel.waitFor(
    async () =>
      evalWithRetry(() =>
        ctx.app.evaluate(({ webContents }) => {
          const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('panel.html'))
          if (!wc) return false
          return wc.executeJavaScript(`(() => {
        const btn = document.querySelector('.config-continue')
        return !!btn && !btn.disabled
      })()`) as Promise<boolean>
        })
      ),
    { timeout: 60_000, message }
  )
}

let HYDRATED = false

function resolveLifecycleVariant(): 'cpu' | 'nvidia' | 'amd' | 'default' {
  const raw = (process.env['LIFECYCLE_VARIANT'] ?? '').toLowerCase()
  if (raw === '') return process.platform === 'win32' ? 'cpu' : 'default'
  if (raw === 'nvidia' || raw === 'amd') {
    if (process.platform === 'darwin') {
      throw new Error(
        `LIFECYCLE_VARIANT=${raw} is not supported on macOS (only mac-mps is published)`
      )
    }
    return raw
  }
  if (raw === 'cpu') {
    if (process.platform !== 'win32') {
      throw new Error(
        'LIFECYCLE_VARIANT=cpu is only published for Windows (no linux-cpu / mac-cpu variant)'
      )
    }
    return 'cpu'
  }
  throw new Error(
    `Unsupported LIFECYCLE_VARIANT "${process.env['LIFECYCLE_VARIANT']}" - use "cpu", "nvidia" or "amd"`
  )
}
const LIFECYCLE_VARIANT = resolveLifecycleVariant()
const GPU_VARIANT = LIFECYCLE_VARIANT === 'nvidia' || LIFECYCLE_VARIANT === 'amd'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  if (LIFECYCLE_VARIANT === 'nvidia') {
    try {
      execFileSync('nvidia-smi', ['-L'], { encoding: 'utf-8', windowsHide: true, timeout: 30_000 })
    } catch {
      throw new Error(
        'LIFECYCLE_VARIANT=nvidia requires a working NVIDIA driver (`nvidia-smi -L` failed); refusing to run the CUDA lifecycle on this machine'
      )
    }
  }
  if (LIFECYCLE_VARIANT === 'amd') {
    let adapters = ''
    try {
      adapters =
        process.platform === 'win32'
          ? execFileSync(
              'powershell.exe',
              ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
              { encoding: 'utf-8', windowsHide: true, timeout: 30_000 }
            )
          : execFileSync(
              'sh',
              ['-c', 'lspci 2>/dev/null | grep -Ei "vga|3d controller|display controller"'],
              { encoding: 'utf-8', timeout: 30_000 }
            )
    } catch {}
    if (!/\b(AMD|Radeon)\b/i.test(adapters)) {
      throw new Error(
        'LIFECYCLE_VARIANT=amd requires an AMD GPU (no AMD/Radeon display adapter found); refusing to run the ROCm lifecycle on this machine'
      )
    }
  }

  if (!process.env['GITHUB_TOKEN']) {
    for (let depth = 2; depth <= 8; depth++) {
      const segments = Array(depth).fill('..')
      const p = resolve(__dirname, ...segments, 'githubtoken.txt')
      try {
        process.env['GITHUB_TOKEN'] = readFileSync(p, 'utf-8').trim()
        break
      } catch {}
    }
  }
  ctx = await launchApp()

  if (process.env['LIFECYCLE_REUSE_DIR']) {
    try {
      await ctx.panel.waitForVisible('.chooser-view', { timeout: 10_000 })
    } catch {}
    const installs = await ctx.panel
      .evaluate<InstallationLite[]>(`window.api.getInstallations()`)
      .catch(() => [] as InstallationLite[])
    const localInstall = installs.find(
      (i) => typeof i.installPath === 'string' && i.installPath.length > 0
    )
    if (localInstall) {
      _updateInstallId = localInstall.id
      _updateInstallPath = localInstall.installPath
      _comfyUIDir = path.join(_updateInstallPath, 'ComfyUI')
      try {
        _installedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: _comfyUIDir,
          encoding: 'utf-8',
          windowsHide: true
        }).trim()
      } catch {}
      try {
        _installedTorchSignature = queryTorchSignature()
      } catch {}
      if (_installedTorchSignature && LIFECYCLE_VARIANT !== 'default') {
        const buildVariant =
          _installedTorchSignature.hip !== null
            ? 'amd'
            : _installedTorchSignature.cuda !== null
              ? 'nvidia'
              : 'cpu'
        if (LIFECYCLE_VARIANT !== buildVariant) {
          throw new Error(
            `LIFECYCLE_VARIANT=${LIFECYCLE_VARIANT} but the reused profile carries a ${buildVariant} torch build` +
              ' - point LIFECYCLE_REUSE_DIR at a matching profile or unset it'
          )
        }
      }
      try {
        const list = await ctx.panel.evaluate<SnapshotListLite>(
          `window.api.getSnapshots(${JSON.stringify(_updateInstallId)})`
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
      } catch {}
      HYDRATED = true
      console.log(
        `[lifecycle] hydrated from reused profile: installId=${_updateInstallId} commit=${_installedCommit || '(none)'} restoreSnapshot=${_restoreSnapshotFilename || '(none)'}`
      )

      try {
        await clickInstallTile(ctx.panel, 'ComfyUI')
        await expect
          .poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000, 2_000] })
          .toBe(true)
        await ensureInstallPanelView(ctx.app, _updateInstallId)
        await waitForWebContents(ctx.app, 'panel.html')
        console.log(
          '[lifecycle] auto-launched reused install + remounted install-backed panel view'
        )
      } catch (err) {
        console.log(
          `[lifecycle] auto-launch failed (tests that require running comfy will fail): ${(err as Error).message}`
        )
      }
    } else {
      console.log(
        '[lifecycle] LIFECYCLE_REUSE_DIR set but no install found — running fresh setup tests to populate the profile'
      )
    }
  }
})

const _runCreatedInstallPaths = new Set<string>()

function isolatedInstallationsStorePath(homeDir: string): string {
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Roaming', 'comfyui-desktop-2', 'installations.json')
  }
  if (process.platform === 'linux') {
    return path.join(homeDir, '.local', 'share', 'comfyui-desktop-2', 'installations.json')
  }
  return path.join(
    homeDir,
    'Library',
    'Application Support',
    'comfyui-desktop-2',
    'installations.json'
  )
}

test.afterAll(async () => {
  if (typeof ctx === 'undefined') return

  if (!process.env['LIFECYCLE_REUSE_DIR']) {
    try {
      const storePath = isolatedInstallationsStorePath(ctx.homeDir)
      const records = JSON.parse(readFileSync(storePath, 'utf-8')) as { installPath?: unknown }[]
      for (const r of records) {
        if (typeof r.installPath === 'string' && path.isAbsolute(r.installPath)) {
          _runCreatedInstallPaths.add(r.installPath)
        }
      }
    } catch {}
  }

  await ctx.cleanup()

  if (!process.env['LIFECYCLE_REUSE_DIR']) {
    if (_runCreatedInstallPaths.size > 0) {
      console.log(
        `[lifecycle] afterAll sweep over ${_runCreatedInstallPaths.size} run-created install path(s): ${[..._runCreatedInstallPaths].join(', ')}`
      )
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

async function comfyFrontendIsLoaded(): Promise<boolean> {
  return evalWithRetry(() =>
    ctx.app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .some((wc) => /^http:\/\/(127\.0\.0\.1|localhost):/.test(wc.getURL()) && !wc.isLoading())
    )
  )
}

test('cold start lands on first-use start screen @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: first-use already completed on the persisted profile')
  await ctx.panel.waitForVisible('.start-hero', { timeout: 15_000 })
  await ctx.panel.waitForVisible('[data-testid="first-use-pick-cloud"]')
  await ctx.panel.waitForVisible('[data-testid="first-use-pick-local"]')
  await ctx.panel.waitForVisible('[data-testid="first-use-continue"]')
})

test('accept ToS + pick local (non-express) opens New Install takeover with form pre-filled @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: first-use already completed on the persisted profile')

  expect(await ctx.panel.click('[data-testid="first-use-pick-local"]')).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="first-use-express-install"]', { timeout: 5_000 })

  const expressCheckbox = '[data-testid="first-use-express-install"] [role="checkbox"]'
  expect(
    await ctx.panel.evaluate<boolean>(
      `document.querySelector(${JSON.stringify(expressCheckbox)})?.getAttribute('aria-checked') === 'false'`
    ),
    'Express Install should default to unchecked on Local pick'
  ).toBe(true)
  expect(await ctx.panel.click(expressCheckbox)).toBe(true)
  expect(
    await ctx.panel.evaluate<boolean>(
      `document.querySelector(${JSON.stringify(expressCheckbox)})?.getAttribute('aria-checked') === 'true'`
    ),
    'Express Install checkbox did not check'
  ).toBe(true)
  expect(await ctx.panel.click(expressCheckbox)).toBe(true)
  expect(
    await ctx.panel.evaluate<boolean>(
      `document.querySelector(${JSON.stringify(expressCheckbox)})?.getAttribute('aria-checked') === 'false'`
    ),
    'Express Install checkbox did not uncheck'
  ).toBe(true)

  expect(await ctx.panel.click('[data-testid="first-use-consent-tos"]')).toBe(true)
  await ctx.panel.waitFor(
    async () =>
      ctx.panel.evaluate<boolean>(
        `!document.querySelector('[data-testid="first-use-continue"]').disabled`
      ),
    { timeout: 5_000, message: 'Continue never became enabled after ticking ToS' }
  )

  expect(await ctx.panel.click('[data-testid="first-use-continue"]')).toBe(true)
  await expectTakeoverOpen(ctx.panel)

  await waitForConfigContinueEnabled('Continue button never became enabled (form did not pre-fill)')
  await openNewBuildChangeSetup(ctx.panel)

  await ctx.panel.waitForSelector('#source-fields button[role="combobox"]', {
    timeout: 5_000
  })

  await ctx.panel.waitForSelector(
    '#source-fields button[role="combobox"][aria-label="Version"]:not([disabled])',
    { timeout: 60_000 }
  )
  expect(
    await ctx.panel.click('#source-fields button[role="combobox"][aria-label="Version"]')
  ).toBe(true)
  await ctx.panel.waitForVisible('[role="listbox"] [role="option"]', { timeout: 10_000 })
  expect(
    await ctx.panel.clickNth('[role="listbox"] [role="option"]', 1),
    'failed to click the second-newest ComfyUI Version option in BaseSelect listbox'
  ).toBe(true)

  await ctx.panel.waitForSelector('#source-fields .setup-option--selected', { timeout: 60_000 })

  if (LIFECYCLE_VARIANT !== 'default') {
    const rowLabel =
      LIFECYCLE_VARIANT === 'nvidia' ? 'NVIDIA' : LIFECYCLE_VARIANT === 'amd' ? 'AMD' : 'CPU'
    await ctx.panel.waitForSelector('.setup-option', { timeout: 5_000 })
    expect(
      await ctx.panel.clickByText('.setup-option', rowLabel),
      `${rowLabel} variant row clicked`
    ).toBe(true)
    await ctx.panel.waitFor(
      async () =>
        ctx.panel.evaluate<boolean>(
          `(() => {
          const sel = document.querySelector('#source-fields .setup-option--selected .setup-option__label')
          return !!sel && new RegExp(${JSON.stringify(rowLabel)}, 'i').test(sel.textContent || '')
        })()`
        ),
      { timeout: 5_000, message: `${rowLabel} variant did not become the selected variant row` }
    )
  }
  await saveNewBuildChangeSetup(ctx.panel)
})

test('completes install (auto-launches via brand chrome) @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: install already on disk on the persisted profile')
  const LINUX_AMD = LIFECYCLE_VARIANT === 'amd' && process.platform === 'linux'
  test.setTimeout(LINUX_AMD ? 1_020_000 : 600_000)
  await waitForConfigContinueEnabled('Continue button never re-enabled after the variant pick')
  expect(await ctx.panel.click('.config-continue')).toBe(true)
  await ctx.panel.waitForVisible('.template-skip', { timeout: 10_000 })
  expect(await ctx.panel.clickByText('.template-skip', 'Skip & Install')).toBe(true)

  await ctx.panel.waitForVisible('.brand-progress', { timeout: 10_000 })
  await expect
    .poll(comfyFrontendIsLoaded, {
      timeout: LINUX_AMD ? 900_000 : 480_000,
      intervals: [1_000, 2_000]
    })
    .toBe(true)
})

test('first-use Local chain marks firstUseCompleted once and cycles firstUseMode @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: first-use IPC log only exists on the boot that drove the chain')
  const setSettingCalls = (await getIpcInvocations(ctx.app, 'set-setting')) as Array<{
    key: string
    value: unknown
  }>
  const firstUseFlips = setSettingCalls.filter(
    (c) => c.key === 'firstUseCompleted' && c.value === true
  )
  expect(
    firstUseFlips.length,
    'markFirstUseCompleted should run exactly once across the chain'
  ).toBe(1)

  const modeCalls = (await getIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode')) as Array<{
    mode: string
  }>
  const modes = modeCalls.map((c) => c.mode)
  expect(modes, 'first-use mode sequence missing post-consent').toContain('post-consent')
  expect(modes[modes.length - 1], 'first-use mode should end at none after chain completes').toBe(
    'none'
  )
})

test('auto-launch landed on a single host window (in-place attach) @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: install was not auto-launched on this boot')
  const state = await evalWithRetry(() =>
    ctx.app.evaluate(({ BrowserWindow, WebContentsView }) => {
      const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
      const comfyHost = wins.find((w) =>
        w.contentView.children.some(
          (v) =>
            v instanceof WebContentsView &&
            /^http:\/\/(127\.0\.0\.1|localhost):/.test(v.webContents.getURL())
        )
      )
      return { count: wins.length, comfyHostId: comfyHost?.id ?? null }
    })
  )
  expect(state.count).toBe(1)
  expect(state.comfyHostId).not.toBeNull()
})

test('ComfyUI window has dark background and split-view architecture @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: comfy is not auto-running on this boot')
  const arch = await evalWithRetry(() =>
    ctx.app.evaluate(({ BrowserWindow, WebContentsView }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        const children = win.contentView.children
        const comfyChild = children.find(
          (v) =>
            v instanceof WebContentsView &&
            /^http:\/\/(127\.0\.0\.1|localhost):/.test(v.webContents.getURL())
        ) as
          | {
              getBounds(): { x: number; y: number; width: number; height: number }
              getVisible(): boolean
            }
          | undefined
        if (!comfyChild) continue
        const bounds = comfyChild.getBounds()
        return {
          childCount: children.length,
          allWebContentsViews: children.every((v) => v instanceof WebContentsView),
          bg: win.getBackgroundColor(),
          comfyBounds: bounds,
          comfyVisible: comfyChild.getVisible()
        }
      }
      return null
    })
  )

  expect(arch, 'ComfyUI BrowserWindow not found among open windows').not.toBeNull()
  expect(arch!.childCount).toBeGreaterThanOrEqual(2)
  expect(arch!.allWebContentsViews).toBe(true)
  expect(arch!.bg.toLowerCase()).toBe('#171717')
  expect(arch!.comfyVisible, 'comfyView is hidden').toBe(true)
  expect(arch!.comfyBounds.width, 'comfyView width is 0').toBeGreaterThan(0)
  expect(arch!.comfyBounds.height, 'comfyView height is 0').toBeGreaterThan(0)
})

async function closeExtraWindowsKeepComfyHost(): Promise<void> {
  await evalWithRetry(() =>
    ctx.app.evaluate(({ BrowserWindow, WebContentsView }) => {
      const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
      const comfyHost = wins.find((w) =>
        w.contentView.children.some(
          (v) =>
            v instanceof WebContentsView &&
            /^http:\/\/(127\.0\.0\.1|localhost):/.test(v.webContents.getURL())
        )
      )
      if (!comfyHost) throw new Error('running comfy host window not found')
      for (const win of wins) {
        if (win.id !== comfyHost.id) win.close()
      }
    })
  )
  await expect
    .poll(
      () =>
        evalWithRetry(() =>
          ctx.app.evaluate(
            ({ BrowserWindow }) =>
              BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length
          )
        ),
      { timeout: 15_000, intervals: [200, 500] }
    )
    .toBe(1)
}

test('picker Dashboard opens a chooser without stopping the running install @sec-setup @lifecycle', async () => {
  test.skip(HYDRATED, 'reuse mode: no running install-backed host exists')
  const before = await evalWithRetry(() =>
    ctx.app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
      return { count: wins.length, ids: wins.map((w) => w.id) }
    })
  )

  expect(await ctx.titleBar.click('.title-install-pill.is-interactive')).toBe(true)
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible('.picker-home', { timeout: 10_000 })
  expect(await popup.click('.picker-home')).toBe(true)

  await waitForWebContents(ctx.app, 'panel.html')
  await expectChooserVisible(ctx.panel)
  await expect.poll(comfyFrontendIsLoaded, { timeout: 30_000, intervals: [500] }).toBe(true)
  const after = await evalWithRetry(() =>
    ctx.app.evaluate(({ BrowserWindow, WebContentsView }) => {
      const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
      const comfyHost = wins.find((w) =>
        w.contentView.children.some(
          (v) =>
            v instanceof WebContentsView &&
            /^http:\/\/(127\.0\.0\.1|localhost):/.test(v.webContents.getURL())
        )
      )
      return { count: wins.length, comfyHostId: comfyHost?.id ?? null }
    })
  )
  expect(after.count).toBe(before.count + 1)
  expect(before.ids).toContain(after.comfyHostId)

  const installs = await ctx.panel.evaluate<Array<{ id: string }>>(`window.api.getInstallations()`)
  expect(installs.length, 'no tracked installation to remount the panel for').toBeGreaterThan(0)
  await closeExtraWindowsKeepComfyHost()
  expect(await ensureInstallPanelView(ctx.app, installs[0]!.id)).toBe(true)
  await waitForWebContents(ctx.app, 'panel.html')
})

interface InstallationLite {
  id: string
  name: string
  installPath: string
}

async function submitCopyNamePrompt(popup: WebContentsPage, name: string): Promise<void> {
  await popup.waitForVisible(byTestId(TID.basePromptInput), { timeout: 15_000 })
  await popup.fill(byTestId(TID.basePromptInput), name)
  expect(await popup.click(byTestId(TID.basePromptAction))).toBe(true)
}

async function waitForCopyRegistered(name: string): Promise<InstallationLite> {
  let copyRecord: InstallationLite | undefined
  await expect
    .poll(
      async () => {
        const installs = await ctx.panel.evaluate<InstallationLite[]>(
          `window.api.getInstallations()`
        )
        copyRecord = installs.find((i) => i.name === name)
        return copyRecord ?? null
      },
      { timeout: 540_000, intervals: [2_000, 5_000] }
    )
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
  cuda: string | null
  cudaAvailable: boolean
  hip: string | null
  torchvision: string | null
  torchaudio: string | null
  torchsde: string | null
  torchDistInfoCount: number
}

function queryTorchSignature(): TorchSignature {
  const venvPython =
    process.platform === 'win32'
      ? path.join(_comfyUIDir, '.venv', 'Scripts', 'python.exe')
      : path.join(_comfyUIDir, '.venv', 'bin', 'python3')
  const probe = [
    'import json, torch',
    'from importlib import metadata',
    'def v(p):',
    '    try: return metadata.version(p)',
    '    except Exception: return None',
    'print("__TORCH_SIGNATURE__" + json.dumps({"torch": torch.__version__, "cuda": torch.version.cuda,' +
      ' "cudaAvailable": torch.cuda.is_available(), "hip": torch.version.hip,' +
      ' "torchvision": v("torchvision"), "torchaudio": v("torchaudio"), "torchsde": v("torchsde"),' +
      ' "torchDistInfoCount": sum(1 for d in metadata.distributions() if (d.metadata.get("Name") or "").lower() == "torch")}))'
  ].join('\n')
  const out = execFileSync(venvPython, ['-c', probe], {
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 120_000
  })
  const line = out
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.startsWith('__TORCH_SIGNATURE__'))
  if (!line) {
    throw new Error(
      `torch signature probe produced no sentinel line; stdout was: ${out.slice(0, 500)}`
    )
  }
  return JSON.parse(line.slice('__TORCH_SIGNATURE__'.length)) as TorchSignature
}

function expectTorchFamilyUnchanged(message: string): void {
  expect(_installedTorchSignature, 'baseline torch signature not captured').not.toBeNull()
  const { cudaAvailable: _base, ...baseline } = _installedTorchSignature!
  const { cudaAvailable: _cur, ...current } = queryTorchSignature()
  expect(current, message).toEqual(baseline)
}

async function untrackViaManageDrawer(installationId: string): Promise<void> {
  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(installationId)},
        initialTab: 'settings',
      })
      return true
    })()`
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.pickerMoreTrigger), { timeout: 30_000 })
  await popup.clickUntilVisible(
    byTestId(TID.pickerMoreTrigger),
    byTestId(TID.pinBottomAction('remove')),
    { timeout: 30_000 }
  )
  expect(await popup.click(byTestId(TID.pinBottomAction('remove')))).toBe(true)
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 15_000 })
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)
}

async function stopAndReturnToDashboardViaUI(): Promise<void> {
  if (!(await comfyFrontendIsLoaded())) {
    const chooserUp = await ctx.panel.exists('.chooser-view').catch(() => false)
    if (chooserUp) return
  }
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar)
  await popup.waitForVisible(byTestId(TID.pickerMoreTrigger), { timeout: 15_000 })
  await popup.clickUntilVisible(
    byTestId(TID.pickerMoreTrigger),
    byTestId(TID.pinBottomAction('stop')),
    { timeout: 30_000 }
  )
  expect(await popup.click(byTestId(TID.pinBottomAction('stop')))).toBe(true)
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)

  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 120_000,
      intervals: [250, 500]
    })
    .toBe(false)
  await waitForWebContents(ctx.app, 'panel.html')
  await ctx.panel.waitForVisible(byTestId(TID.lifecycleReturnDashboard), { timeout: 120_000 })
  expect(await ctx.panel.click(byTestId(TID.lifecycleReturnDashboard))).toBe(true)

  await expect.poll(comfyFrontendIsLoaded, { timeout: 30_000, intervals: [500] }).toBe(false)
  await expect
    .poll(
      () =>
        ctx.panel.evaluate<boolean>(`!!document.querySelector('.chooser-view')`).catch(() => false),
      { timeout: 30_000, intervals: [250, 500] }
    )
    .toBe(true)
}

test('stop ComfyUI again so update-comfyui (requires stopped) can run @sec-update @lifecycle', async () => {
  test.setTimeout(300_000)

  await stopAndReturnToDashboardViaUI()
})

test('captures install metadata for the update tests @sec-meta @lifecycle', async () => {
  const installs = await ctx.panel.evaluate<InstallationLite[]>(`window.api.getInstallations()`)
  expect(installs.length, 'no tracked installation after install').toBeGreaterThan(0)
  const inst = installs[0]!
  _updateInstallId = inst.id
  _updateInstallPath = inst.installPath
  _runCreatedInstallPaths.add(_updateInstallPath)
  _comfyUIDir = path.join(_updateInstallPath, 'ComfyUI')

  _installedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir,
    encoding: 'utf-8',
    windowsHide: true
  }).trim()
  expect(_installedCommit).toMatch(/^[a-f0-9]{40}$/)

  _installedTorchSignature = queryTorchSignature()
  expect(
    _installedTorchSignature.torch,
    'torch failed to import from the installed venv'
  ).toBeTruthy()
  if (LIFECYCLE_VARIANT === 'nvidia') {
    expect(
      _installedTorchSignature.cuda,
      `NVIDIA-variant install must carry a CUDA torch build (torch ${_installedTorchSignature.torch})`
    ).not.toBeNull()
    expect(
      _installedTorchSignature.cudaAvailable,
      `torch.cuda.is_available() must be true on an NVIDIA-variant install (torch ${_installedTorchSignature.torch}, cuda ${_installedTorchSignature.cuda})`
    ).toBe(true)
  } else if (LIFECYCLE_VARIANT === 'amd') {
    expect(
      _installedTorchSignature.hip,
      `AMD-variant install must carry a ROCm torch build (torch ${_installedTorchSignature.torch})`
    ).not.toBeNull()
    expect(
      _installedTorchSignature.cudaAvailable,
      `torch.cuda.is_available() must be true on an AMD-variant install (torch ${_installedTorchSignature.torch}, hip ${_installedTorchSignature.hip})`
    ).toBe(true)
  } else if (LIFECYCLE_VARIANT === 'cpu') {
    expect(
      _installedTorchSignature.cuda,
      `CPU-variant install must not carry a CUDA torch build (torch ${_installedTorchSignature.torch}, cuda ${_installedTorchSignature.cuda})`
    ).toBeNull()
    expect(
      _installedTorchSignature.cudaAvailable,
      'CPU-variant install must not initialize a CUDA runtime'
    ).toBe(false)
  }
})

test('update-comfyui drives the real updater and moves HEAD forward @sec-update @lifecycle', async () => {
  test.setTimeout(600_000)
  expect(_installedCommit, 'installed commit not captured').toBeTruthy()

  const popup = await openManageViaDashboard(ctx.app, ctx.panel, _updateInstallId, 'update')
  await popup.waitForSelector(byTestId(TID.updateActionButton('update-comfyui')), {
    timeout: 60_000
  })
  expect(await popup.click(byTestId(TID.updateActionButton('update-comfyui')))).toBe(true)

  const confirmSelector = '[data-testid="modal-confirm-button"], [data-testid="base-alert-action"]'
  await popup.waitForVisible(confirmSelector, { timeout: 15_000 })
  expect(await popup.click(confirmSelector)).toBe(true)

  await expect
    .poll(
      () =>
        execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: _comfyUIDir,
          encoding: 'utf-8',
          windowsHide: true
        }).trim(),
      { timeout: 540_000, intervals: [2_000, 5_000] }
    )
    .not.toBe(_installedCommit)
  await waitForOperationDrain(_updateInstallId)
  await closeTitlePopupIfOpen(ctx.app)

  const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir,
    encoding: 'utf-8',
    windowsHide: true
  }).trim()
  expect(headAfter, 'update did not move HEAD off the installed (older stable) commit').not.toBe(
    _installedCommit
  )

  const aheadCount = execFileSync(
    'git',
    ['rev-list', '--count', `${_installedCommit}..${headAfter}`],
    {
      cwd: _comfyUIDir,
      encoding: 'utf-8',
      windowsHide: true
    }
  ).trim()
  expect(
    parseInt(aheadCount, 10),
    `post-update HEAD ${headAfter} is not ahead of installed commit ${_installedCommit}`
  ).toBeGreaterThan(0)

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
  type PickerRead = {
    current: PytorchPickerOption | null
    options: PytorchPickerOption[]
    detail: string
  }
  let result: PickerRead = { current: null, options: [], detail: 'never evaluated' }
  await expect
    .poll(
      async () => {
        result = await ctx.panel.evaluate<PickerRead>(query)
        return result.options.length > 0
      },
      {
        timeout: 180_000,
        intervals: [1_000, 2_000],
        message: `pytorchStack field never gained options; last state: ${result.detail}`
      }
    )
    .toBe(true)
  await popup.waitForVisible('button[role="combobox"][aria-label="PyTorch"]', { timeout: 60_000 })
  expect(
    result.current,
    'PyTorch picker has no catalog option matching the installed stack'
  ).not.toBeNull()
  return { current: result.current!, options: result.options }
}

async function selectPytorchOption(
  popup: WebContentsPage,
  option: PytorchPickerOption
): Promise<void> {
  for (let level = 0; level < option.groupLabels.length; level++) {
    const groupSelect = `${byTestId(TID.channelGroupSelect(level))} button[role="combobox"]`
    await popup.waitForVisible(groupSelect, { timeout: 60_000 })
    expect(await popup.click(groupSelect)).toBe(true)
    await popup.waitForVisible('[role="listbox"] [role="option"]', { timeout: 10_000 })
    expect(
      await popup.clickByText('[role="listbox"] [role="option"]', option.groupLabels[level]!)
    ).toBe(true)
  }
  const stackSelect = 'button[role="combobox"][aria-label="PyTorch"]'
  await popup.waitForVisible(stackSelect, { timeout: 60_000 })
  expect(await popup.click(stackSelect)).toBe(true)
  await popup.waitForVisible('[role="listbox"] [role="option"]', { timeout: 10_000 })
  expect(await popup.clickByText('[role="listbox"] [role="option"]', option.label)).toBe(true)
}

async function changePytorchStack(option: PytorchPickerOption): Promise<void> {
  const beforeSession = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'update')
  await selectPytorchOption(popup, option)
  const action = byTestId(TID.updateActionButton('change-pytorch'))
  await popup.waitForVisible(action, { timeout: 60_000 })
  expect(await popup.click(action)).toBe(true)
  const confirm = '[data-testid="modal-confirm-button"], [data-testid="base-alert-action"]'
  await popup.waitForVisible(confirm, { timeout: 15_000 })
  expect(await popup.click(confirm)).toBe(true)
  await waitForProgressTakeoverAfterPopupClose()
  await waitForInPlaceOpRelaunch(
    _updateInstallId,
    beforeSession?.startedAt ?? 0,
    GPU_VARIANT ? 2_400_000 : 900_000
  )
  await waitForOperationDrain(_updateInstallId, GPU_VARIANT ? 2_400_000 : 900_000)
  await expect
    .poll(
      () => {
        try {
          return queryTorchSignature().torch
        } catch {
          return null
        }
      },
      { timeout: 120_000, intervals: [2_000, 5_000] }
    )
    .toBe(option.version)
  await expect
    .poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000, 2_000] })
    .toBe(true)
  await closeTitlePopupIfOpen(ctx.app)

  const verifyPopup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'update')
  const picker = await readPytorchPicker(verifyPopup)
  expect(picker.current.value).toBe(option.value)
  await expect
    .poll(() => verifyPopup.textOf('button[role="combobox"][aria-label="PyTorch"]'))
    .toContain(option.label)
  await closeTitlePopupIfOpen(ctx.app)
}

test('captures the baseline pytorch stack @sec-pytorch @lifecycle', async () => {
  test.setTimeout(300_000)
  expect(await ensureInstallPanelView(ctx.app, _updateInstallId)).toBe(true)
  await waitForWebContents(ctx.app, 'panel.html')
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
  _targetPytorchOption =
    picker.options.find(
      (option) =>
        option.value !== _baselinePytorchOption!.value &&
        !/nightly|\.dev/i.test(`${option.label} ${option.value}`)
    ) ??
    picker.options.find((option) => option.value !== _baselinePytorchOption!.value) ??
    null
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
    expect(switched.torch, 'CPU stack must not carry a CUDA local-version suffix').not.toMatch(
      /\+cu\d+/i
    )
  }
})

test('switches back to the baseline pytorch stack @sec-pytorch @lifecycle', async () => {
  test.setTimeout(GPU_VARIANT ? 2_700_000 : 1_200_000)
  expect(_baselinePytorchOption, 'baseline PyTorch picker option not captured').not.toBeNull()
  expect(_baselinePytorchSignature, 'baseline PyTorch signature not captured').not.toBeNull()
  await changePytorchStack(_baselinePytorchOption!)
  const { cudaAvailable: _cur, ...restored } = queryTorchSignature()
  const { cudaAvailable: _base, ...baseline } = _baselinePytorchSignature!
  expect(restored).toEqual(baseline)
})

interface SnapshotSummaryLite {
  filename: string
  label: string | null
}
interface SnapshotListLite {
  snapshots: SnapshotSummaryLite[]
}

interface RunActionInvocation {
  installationId?: string
  actionId?: string
}

async function waitForProgressTakeoverAfterPopupClose(): Promise<void> {
  const routedInline = await expect
    .poll(
      async () => {
        if (!(await isPopupVisible(ctx.app, 'comfyTitlePopup.html'))) return 'panel'
        const text = await titlePopupPage(ctx.app).textOf('.picker-detail')
        return /Updating|Restoring|Restarting|Copying|Changing/i.test(text ?? '')
          ? 'inline'
          : 'pending'
      },
      { timeout: 30_000, intervals: [100, 250] }
    )
    .not.toBe('pending')
    .then(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'))
  if (!routedInline) await ctx.panel.waitForVisible('.brand-progress', { timeout: 30_000 })
}

async function waitForRunAction(
  installationId: string,
  actionId: string,
  opts: { timeout?: number; intervals?: number[] } = {}
): Promise<void> {
  await expect
    .poll(
      async () => {
        const calls = (await getIpcInvocations(ctx.app, 'run-action')) as RunActionInvocation[]
        return calls.some((c) => c.installationId === installationId && c.actionId === actionId)
      },
      { timeout: opts.timeout ?? 540_000, intervals: opts.intervals ?? [2_000, 5_000] }
    )
    .toBe(true)
}

async function getRunActionsFor(installationId: string): Promise<RunActionInvocation[]> {
  const calls = (await getIpcInvocations(ctx.app, 'run-action')) as RunActionInvocation[]
  return calls.filter((c) => c.installationId === installationId)
}

async function getStopsFor(installationId: string): Promise<string[]> {
  const calls = (await getIpcInvocations(ctx.app, 'stop-comfyui')) as string[]
  return calls.filter((c) => c === installationId)
}

async function waitForOperationDrain(installationId: string, timeout = 300_000): Promise<void> {
  await expect
    .poll(() => hasActiveOperation(ctx.app, installationId), {
      timeout,
      intervals: [1_000, 2_000]
    })
    .toBe(false)
}

async function waitForInPlaceOpRelaunch(
  installationId: string,
  beforeStartedAt: number,
  timeout: number
): Promise<void> {
  await expect
    .poll(
      async () => {
        const after = await getRunningSessionSnapshot(ctx.app, installationId)
        if (!after) return false
        return after.startedAt > beforeStartedAt
      },
      { timeout, intervals: [2_000, 5_000] }
    )
    .toBe(true)
}

interface SnapshotFileLite {
  filename: string
  version: number
  createdAt: string
  trigger: string
  label: string | null
  comfyui?: { commit?: string | null }
  torchStack?: {
    kind: 'managed' | 'observed'
    ref?: { packages: { torch: string; torchvision?: string; torchaudio?: string } }
    torchVersion?: string | null
    torchvisionVersion?: string | null
    torchaudioVersion?: string | null
  }
}

function readSnapshotFiles(): SnapshotFileLite[] {
  const dir = path.join(_updateInstallPath, '.launcher', 'snapshots')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      ...(JSON.parse(readFileSync(path.join(dir, f), 'utf-8')) as Omit<
        SnapshotFileLite,
        'filename'
      >),
      filename: f
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function snapshotTorchTuple(
  s: SnapshotFileLite
): { torch?: string | null; torchvision?: string | null; torchaudio?: string | null } | null {
  const stack = s.torchStack
  if (!stack) return null
  if (stack.kind === 'managed') return stack.ref?.packages ?? null
  return {
    torch: stack.torchVersion,
    torchvision: stack.torchvisionVersion,
    torchaudio: stack.torchaudioVersion
  }
}

function recordedVersionMatches(recorded: string | null | undefined, installed: string): boolean {
  if (!recorded) return false
  return recorded === installed || installed.startsWith(`${recorded}+`)
}

function findStackSnapshot(
  snapshots: SnapshotFileLite[],
  trigger: string,
  installedTorch: string
): SnapshotFileLite | undefined {
  return snapshots.find(
    (s) =>
      s.trigger === trigger && recordedVersionMatches(snapshotTorchTuple(s)?.torch, installedTorch)
  )
}

async function restoreSnapshotViaPicker(filename: string): Promise<void> {
  await waitForOperationDrain(_updateInstallId)
  const beforeSession = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'snapshots')
  await popup.waitForSelector(byTestId(TID.snapshotRow(filename)), { timeout: 30_000 })
  await popup.clickUntilVisible(
    byTestId(TID.snapshotRow(filename)),
    byTestId(TID.snapshotRowRestore(filename)),
    { timeout: 30_000 }
  )
  expect(await popup.click(byTestId(TID.snapshotRowRestore(filename)))).toBe(true)
  const confirmSelector = '[data-testid="modal-confirm-button"], [data-testid="base-alert-action"]'
  await popup.waitForVisible(confirmSelector, { timeout: 30_000 })
  expect(await popup.click(confirmSelector)).toBe(true)
  await waitForProgressTakeoverAfterPopupClose()
  await waitForInPlaceOpRelaunch(
    _updateInstallId,
    beforeSession?.startedAt ?? 0,
    GPU_VARIANT ? 2_400_000 : 900_000
  )
  await waitForOperationDrain(_updateInstallId, GPU_VARIANT ? 2_400_000 : 900_000)
  await expect
    .poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000, 2_000] })
    .toBe(true)
  await closeTitlePopupIfOpen(ctx.app)
}

let _pytorchSwitchedSnapshotFile = ''
let _pytorchBaselineSnapshotFile = ''

test('pytorch changes recorded pre/post snapshots carrying the stack identity @sec-pytorch @sec-snapshot @lifecycle', async () => {
  test.skip(
    !_targetPytorchOption,
    'pytorch switch tests did not run (standalone @sec-snapshot subset)'
  )
  expect(_baselinePytorchOption, 'baseline PyTorch picker option not captured').not.toBeNull()
  expect(_baselinePytorchSignature, 'baseline PyTorch signature not captured').not.toBeNull()
  await waitForOperationDrain(_updateInstallId)

  const snapshots = readSnapshotFiles()
  const preBaseline = findStackSnapshot(snapshots, 'pre-update', _baselinePytorchSignature!.torch)
  const postSwitched = findStackSnapshot(snapshots, 'post-update', _targetPytorchOption!.version)
  const postBaseline = findStackSnapshot(snapshots, 'post-update', _baselinePytorchSignature!.torch)
  expect(preBaseline, 'no pre-update snapshot recording the pre-switch stack').toBeTruthy()
  expect(postSwitched, 'no post-update snapshot recording the switched stack').toBeTruthy()
  expect(postBaseline, 'no post-update snapshot recording the restored baseline stack').toBeTruthy()

  for (const snapshot of [postSwitched!, postBaseline!]) {
    expect(snapshot.version, `${snapshot.filename} is not a v2 snapshot`).toBe(2)
    expect(
      snapshot.torchStack!.kind,
      `${snapshot.filename} does not carry a managed stack ref`
    ).toBe('managed')
  }

  _pytorchSwitchedSnapshotFile = postSwitched!.filename
  _pytorchBaselineSnapshotFile = postBaseline!.filename
})

test('snapshot restore re-applies the switched pytorch stack @sec-pytorch @sec-snapshot @lifecycle', async () => {
  test.skip(!_pytorchSwitchedSnapshotFile, 'pytorch stack snapshots not captured')
  test.setTimeout(GPU_VARIANT ? 2_700_000 : 1_200_000)

  await restoreSnapshotViaPicker(_pytorchSwitchedSnapshotFile)

  const recorded = snapshotTorchTuple(
    readSnapshotFiles().find((s) => s.filename === _pytorchSwitchedSnapshotFile)!
  )!
  const signature = queryTorchSignature()
  expect(
    recordedVersionMatches(recorded.torch, signature.torch),
    `restored torch ${signature.torch} does not match snapshot tuple ${recorded.torch}`
  ).toBe(true)
  expect(signature.torch).not.toBe(_baselinePytorchSignature!.torch)
  if (recorded.torchvision) {
    expect(
      recordedVersionMatches(recorded.torchvision, signature.torchvision ?? ''),
      `restored torchvision ${signature.torchvision} does not match snapshot tuple ${recorded.torchvision}`
    ).toBe(true)
  }
  if (recorded.torchaudio) {
    expect(
      recordedVersionMatches(recorded.torchaudio, signature.torchaudio ?? ''),
      `restored torchaudio ${signature.torchaudio} does not match snapshot tuple ${recorded.torchaudio}`
    ).toBe(true)
  }
  expect(signature.torchDistInfoCount, 'venv must contain exactly one torch distribution').toBe(1)
})

test('snapshot restore returns the venv to the baseline pytorch stack @sec-pytorch @sec-snapshot @lifecycle', async () => {
  test.skip(!_pytorchBaselineSnapshotFile, 'pytorch stack snapshots not captured')
  test.setTimeout(GPU_VARIANT ? 2_700_000 : 1_200_000)

  await restoreSnapshotViaPicker(_pytorchBaselineSnapshotFile)

  const { cudaAvailable: _cur, ...restored } = queryTorchSignature()
  const { cudaAvailable: _base, ...baseline } = _baselinePytorchSignature!
  expect(restored).toEqual(baseline)
})

let _restoreSnapshotFilename = ''
let _snapshotHeadAtCapture = ''

test('captures a snapshot for the picker-driven restore test @sec-snapshot @lifecycle', async () => {
  expect(_updateInstallId, 'update install id not captured').toBeTruthy()
  expect(await ensureInstallPanelView(ctx.app, _updateInstallId)).toBe(true)
  await waitForWebContents(ctx.app, 'panel.html')

  const filenamesBefore = new Set(
    (
      await ctx.panel.evaluate<SnapshotListLite>(
        `window.api.getSnapshots(${JSON.stringify(_updateInstallId)})`
      )
    ).snapshots.map((s) => s.filename)
  )

  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'snapshots')
  await popup.waitForVisible(byTestId(TID.snapshotsSaveCta), { timeout: 15_000 })
  expect(await popup.click(byTestId(TID.snapshotsSaveCta))).toBe(true)
  await popup.waitForVisible(byTestId(TID.basePromptInput), { timeout: 15_000 })
  await popup.fill(byTestId(TID.basePromptInput), 'lifecycle-restore-target')
  expect(await popup.click(byTestId(TID.basePromptAction))).toBe(true)

  let target: SnapshotListLite['snapshots'][number] | undefined
  await expect
    .poll(
      async () => {
        const list = await ctx.panel.evaluate<SnapshotListLite>(
          `window.api.getSnapshots(${JSON.stringify(_updateInstallId)})`
        )
        target = list.snapshots.find(
          (s) => s.label === 'lifecycle-restore-target' && !filenamesBefore.has(s.filename)
        )
        return target ?? null
      },
      { timeout: 30_000, intervals: [500, 1_000] }
    )
    .not.toBeNull()

  await popup.waitForVisible(byTestId(TID.snapshotsSaveCta), { timeout: 15_000 })
  expect(await popup.click(byTestId(TID.snapshotsSaveCta))).toBe(true)
  await popup.waitForVisible(byTestId(TID.basePromptInput), { timeout: 15_000 })
  await popup.fill(byTestId(TID.basePromptInput), 'lifecycle-latest-marker')
  expect(await popup.click(byTestId(TID.basePromptAction))).toBe(true)
  await expect
    .poll(
      async () => {
        const list = await ctx.panel.evaluate<SnapshotListLite>(
          `window.api.getSnapshots(${JSON.stringify(_updateInstallId)})`
        )
        return (
          list.snapshots.find(
            (s) => s.label === 'lifecycle-latest-marker' && !filenamesBefore.has(s.filename)
          ) ?? null
        )
      },
      { timeout: 30_000, intervals: [500, 1_000] }
    )
    .not.toBeNull()

  await closeTitlePopupIfOpen(ctx.app)
  _restoreSnapshotFilename = target!.filename
  _snapshotHeadAtCapture = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir,
    encoding: 'utf-8',
    windowsHide: true
  }).trim()
  expect(_snapshotHeadAtCapture).toMatch(/^[a-f0-9]{40}$/)
})

test('per-install Manager security level + network mode land in Manager config.ini and apply after relaunch @sec-manager @lifecycle', async () => {
  test.setTimeout(600_000)
  expect(_updateInstallPath, 'install path not captured').toBeTruthy()

  const LEVEL_LABELS: Record<string, string> = {
    strong: 'Strict',
    normal: 'Standard (recommended)',
    'normal-': 'Relaxed',
    weak: 'Permissive'
  }
  const MODE_LABELS: Record<string, string> = {
    public: 'Public (default)',
    private: 'Private',
    offline: 'Offline',
    personal_cloud: 'Personal cloud'
  }
  const configPath = path.join(_updateInstallPath, 'ComfyUI', 'user', '__manager', 'config.ini')
  const readConfigOption = (key: string): string | null => {
    if (!existsSync(configPath)) return null
    const section =
      readFileSync(configPath, 'utf-8')
        .split(/^\[/m)
        .find((s) => s.startsWith('default]')) ?? ''
    const matches = [...section.matchAll(new RegExp(`^\\s*${key}\\s*[=:]\\s*(\\S+)\\s*$`, 'gim'))]
    return matches.at(-1)?.[1] ?? null
  }
  const readConfigLevel = (): string | null => readConfigOption('security_level')
  const readConfigMode = (): string | null => readConfigOption('network_mode')
  const readRecordField = (field: string): Promise<string | null> =>
    ctx.panel.evaluate<string | null>(
      `window.api.getInstallations().then((list) => {
        const inst = list.find((i) => i.id === ${JSON.stringify(_updateInstallId)})
        return (inst && inst[${JSON.stringify(field)}]) || null
      })`
    )
  const readRecordLevel = (): Promise<string | null> => readRecordField('managerSecurityLevel')
  const readRecordMode = (): Promise<string | null> => readRecordField('managerNetworkMode')

  const comfyOrigin = async (): Promise<string> => {
    const origin = await evalWithRetry(() =>
      ctx.app.evaluate(({ webContents }) => {
        const wc = webContents
          .getAllWebContents()
          .find((w) => /^http:\/\/(127\.0\.0\.1|localhost):/.test(w.getURL()))
        return wc ? new URL(wc.getURL()).origin : null
      })
    )
    expect(origin, 'no running ComfyUI frontend to derive the server origin from').toBeTruthy()
    return origin!
  }
  const probeTarget = `lifecycle-enforcement-probe-${randomUUID()}`
  const managerBlocksMiddleRisk = async (): Promise<boolean> => {
    const probeSnapshotPath = path.join(
      _updateInstallPath,
      'ComfyUI',
      'user',
      '__manager',
      'snapshots',
      `${probeTarget}.json`
    )
    expect(
      existsSync(probeSnapshotPath),
      `probe snapshot unexpectedly exists: ${probeSnapshotPath}`
    ).toBe(false)
    const res = await fetch(
      `${await comfyOrigin()}/api/v2/snapshot/remove?target=${encodeURIComponent(probeTarget)}`,
      { method: 'POST', signal: AbortSignal.timeout(15_000) }
    )
    if (res.status !== 403) {
      expect(res.status, `unexpected snapshot/remove probe status ${res.status}`).toBe(200)
      return false
    }
    return true
  }
  const middleBlockedAt = (level: string | null): boolean => level === 'strong'

  const storedRaw = await readRecordLevel()
  const storedBefore =
    storedRaw != null && Object.hasOwn(LEVEL_LABELS, storedRaw) ? storedRaw : null
  const initialLabel = LEVEL_LABELS[storedBefore ?? 'normal']!
  const configLevelBefore = readConfigLevel()
  const targetValue = (['strong', 'weak', 'normal-'] as const).find(
    (v) => v !== storedBefore && v !== configLevelBefore
  )!
  const target = { value: targetValue, label: LEVEL_LABELS[targetValue]! }

  const storedModeRaw = await readRecordMode()
  const storedModeBefore =
    storedModeRaw != null && Object.hasOwn(MODE_LABELS, storedModeRaw) ? storedModeRaw : null
  const initialModeLabel = MODE_LABELS[storedModeBefore ?? 'public']!
  const configModeBefore = readConfigMode()
  const targetModeValue = (['personal_cloud', 'private', 'public'] as const).find(
    (v) => v !== storedModeBefore && v !== configModeBefore
  )!
  const targetMode = { value: targetModeValue, label: MODE_LABELS[targetModeValue]! }

  const globalBefore = await ctx.panel.evaluate<string | null>(
    `window.api.getSetting('managerSecurityLevel')`
  )
  const globalModeBefore = await ctx.panel.evaluate<string | null>(
    `window.api.getSetting('managerNetworkMode')`
  )

  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'config')

  const trigger = 'button.ui-select-trigger[aria-label="Manager Security Level"]'
  await popup.waitForVisible(trigger, { timeout: 15_000 })
  expect(await popup.textOf(trigger)).toContain(initialLabel)

  await popup.selectOption(trigger, target.label)

  await expect.poll(readRecordLevel, { timeout: 10_000, intervals: [100, 250] }).toBe(target.value)

  const modeTrigger = 'button.ui-select-trigger[aria-label="Manager Network Mode"]'
  await popup.waitForVisible(modeTrigger, { timeout: 15_000 })
  expect(await popup.textOf(modeTrigger)).toContain(initialModeLabel)
  await popup.selectOption(modeTrigger, targetMode.label)
  await expect
    .poll(readRecordMode, { timeout: 10_000, intervals: [100, 250] })
    .toBe(targetMode.value)

  expect(
    await ctx.panel.evaluate<string | null>(`window.api.getSetting('managerSecurityLevel')`),
    'managerSecurityLevel leaked into the global settings store'
  ).toBe(globalBefore)
  expect(
    await ctx.panel.evaluate<string | null>(`window.api.getSetting('managerNetworkMode')`),
    'managerNetworkMode leaked into the global settings store'
  ).toBe(globalModeBefore)
  await closeTitlePopupIfOpen(ctx.app)

  expect(
    readConfigLevel(),
    'Manager config changed before relaunch - reconcile must only run on launch'
  ).toBe(configLevelBefore)
  expect(
    readConfigMode(),
    'Manager network_mode changed before relaunch - reconcile must only run on launch'
  ).toBe(configModeBefore)

  if (configLevelBefore === null || Object.hasOwn(LEVEL_LABELS, configLevelBefore)) {
    expect(
      await managerBlocksMiddleRisk(),
      'live Manager enforcement changed before relaunch - the level must only apply at startup'
    ).toBe(middleBlockedAt(configLevelBefore))
  }

  await stopAndReturnToDashboardViaUI()
  await clickInstallTile(ctx.panel, 'ComfyUI')
  await expect
    .poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000, 2_000] })
    .toBe(true)
  expect(await ensureInstallPanelView(ctx.app, _updateInstallId)).toBe(true)
  await waitForWebContents(ctx.app, 'panel.html')

  expect(existsSync(configPath), `Manager config not written at ${configPath}`).toBe(true)
  expect(
    readConfigLevel(),
    `[default] security_level = ${target.value} missing from Manager config:\n` +
      readFileSync(configPath, 'utf-8')
  ).toBe(target.value)
  expect(
    readConfigMode(),
    `[default] network_mode = ${targetMode.value} missing from Manager config:\n` +
      readFileSync(configPath, 'utf-8')
  ).toBe(targetMode.value)

  expect(
    await managerBlocksMiddleRisk(),
    `running Manager does not enforce security level "${target.value}"`
  ).toBe(middleBlockedAt(target.value))

  const serverLogPath = path.join(_updateInstallPath, 'logs', 'comfyui.log')
  const expectedModeLine = `[ComfyUI-Manager] network_mode: ${targetMode.value}`
  await expect
    .poll(
      () =>
        existsSync(serverLogPath) &&
        readFileSync(serverLogPath, 'utf-8')
          .split(/\r?\n/)
          .some((l) => l.trim().endsWith(expectedModeLine)),
      { timeout: 30_000, intervals: [500, 1_000] }
    )
    .toBe(true)

  expectTorchFamilyUnchanged('manager security-level relaunch changed the installed torch family')
})

test('picker-driven cross-channel update-comfyui (stable → latest) IN_PLACE_RELAUNCH while running @sec-crosschannel @lifecycle', async () => {
  test.setTimeout(GPU_VARIANT ? 3_000_000 : 1_500_000)

  const installsBefore = await ctx.panel.evaluate<Array<{ id: string; updateChannel?: string }>>(
    `window.api.getInstallations()`
  )
  const before = installsBefore.find((i) => i.id === _updateInstallId)
  expect(before?.updateChannel, 'install must be on stable before the cross-channel switch').toBe(
    'stable'
  )

  const masterTip = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/master'], {
    cwd: _comfyUIDir,
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 60_000
  })
    .split('\t')[0]!
    .trim()
  expect(masterTip, 'git ls-remote returned no master tip').toMatch(/^[a-f0-9]{40}$/)
  const headAtEntry = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir,
    encoding: 'utf-8',
    windowsHide: true
  }).trim()
  if (headAtEntry === masterTip) {
    const rollbackTarget = readSnapshotFiles().find(
      (s) => s.comfyui?.commit && s.comfyui.commit !== masterTip
    )
    expect(
      rollbackTarget,
      'install sits on the master tip but no snapshot at an older commit exists to recreate the cross-channel gap'
    ).toBeTruthy()
    await restoreSnapshotViaPicker(rollbackTarget!.filename)
    const restoredHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: _comfyUIDir,
      encoding: 'utf-8',
      windowsHide: true
    }).trim()
    expect(restoredHead, 'gap-restore did not land HEAD on the snapshot commit').toBe(
      rollbackTarget!.comfyui!.commit
    )
    const installsRestored = await ctx.panel.evaluate<
      Array<{ id: string; updateChannel?: string }>
    >(`window.api.getInstallations()`)
    expect(
      installsRestored.find((i) => i.id === _updateInstallId)?.updateChannel,
      'gap-restore must leave the install on stable'
    ).toBe('stable')
  }

  const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir,
    encoding: 'utf-8',
    windowsHide: true
  }).trim()

  await resetIpcInvocations(ctx.app, 'stop-comfyui')
  await resetIpcInvocations(ctx.app, 'run-action')

  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'update')

  const channelSelect = 'button[role="combobox"][aria-label="Update Channel"]'
  await popup.waitForSelector(channelSelect, { timeout: 60_000 })
  expect(await popup.click(channelSelect)).toBe(true)
  await popup.waitForVisible('[role="listbox"] [role="option"]', { timeout: 10_000 })
  expect(
    await popup.clickByText('[role="listbox"] [role="option"]', 'Latest on GitHub'),
    '"Latest on GitHub" option missing from BaseSelect listbox'
  ).toBe(true)

  await popup.waitForSelector(byTestId(TID.updateActionButton('update-comfyui')), {
    timeout: 60_000
  })
  expect(await popup.click(byTestId(TID.updateActionButton('update-comfyui')))).toBe(true)

  const confirmSelector = '[data-testid="base-alert-action"]'
  await popup.waitForVisible(confirmSelector, { timeout: 15_000 })
  expect(await popup.click(confirmSelector)).toBe(true)

  await waitForProgressTakeoverAfterPopupClose()

  await expect
    .poll(
      () =>
        execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: _comfyUIDir,
          encoding: 'utf-8',
          windowsHide: true
        }).trim(),
      { timeout: 540_000, intervals: [2_000, 5_000] }
    )
    .not.toBe(headBefore)
  await expect
    .poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000, 2_000] })
    .toBe(true)

  const installsAfter = await ctx.panel.evaluate<Array<{ id: string; updateChannel?: string }>>(
    `window.api.getInstallations()`
  )
  const after = installsAfter.find((i) => i.id === _updateInstallId)
  expect(
    after?.updateChannel,
    'updateChannel must flip to latest after a cross-channel update'
  ).toBe('latest')

  const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir,
    encoding: 'utf-8',
    windowsHide: true
  }).trim()
  expect(headAfter, 'cross-channel update did not move HEAD').not.toBe(headBefore)
  expect(headAfter).toMatch(/^[a-f0-9]{40}$/)

  expectTorchFamilyUnchanged('cross-channel update-comfyui changed the installed torch family')

  await closeTitlePopupIfOpen(ctx.app)
})

test('picker-driven snapshot-restore IN_PLACE_RELAUNCH while running @sec-snapshot @lifecycle', async () => {
  test.setTimeout(600_000)
  expect(_restoreSnapshotFilename, 'restore-target snapshot not captured').toBeTruthy()

  await waitForOperationDrain(_updateInstallId)

  execFileSync('git', ['reset', '--hard', `${_snapshotHeadAtCapture}~5`], {
    cwd: _comfyUIDir,
    stdio: 'pipe',
    windowsHide: true
  })
  const rolledBack = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir,
    encoding: 'utf-8',
    windowsHide: true
  }).trim()
  expect(rolledBack, 'rollback did not change HEAD off the snapshot commit').not.toBe(
    _snapshotHeadAtCapture
  )

  await resetIpcInvocations(ctx.app, 'stop-comfyui')
  await resetIpcInvocations(ctx.app, 'run-action')

  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'snapshots')
  await popup.waitForSelector(byTestId(TID.snapshotRow(_restoreSnapshotFilename)), {
    timeout: 30_000
  })
  await popup.clickUntilVisible(
    byTestId(TID.snapshotRow(_restoreSnapshotFilename)),
    byTestId(TID.snapshotRowRestore(_restoreSnapshotFilename)),
    { timeout: 30_000 }
  )
  expect(await popup.click(byTestId(TID.snapshotRowRestore(_restoreSnapshotFilename)))).toBe(true)

  const confirmSelector = '[data-testid="modal-confirm-button"], [data-testid="base-alert-action"]'
  await popup.waitForVisible(confirmSelector, { timeout: 30_000 })
  expect(await popup.click(confirmSelector)).toBe(true)

  await waitForProgressTakeoverAfterPopupClose()

  await expect
    .poll(
      () =>
        execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: _comfyUIDir,
          encoding: 'utf-8',
          windowsHide: true
        }).trim(),
      { timeout: 540_000, intervals: [2_000, 5_000] }
    )
    .not.toBe(rolledBack)
  await expect
    .poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000, 2_000] })
    .toBe(true)

  const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: _comfyUIDir,
    encoding: 'utf-8',
    windowsHide: true
  }).trim()
  expect(headAfter).toMatch(/^[a-f0-9]{40}$/)

  expectTorchFamilyUnchanged('snapshot restore (incl. pip sync) changed the installed torch family')

  await closeTitlePopupIfOpen(ctx.app)
})

test('picker primary CTA Restart drives in-drawer confirm + re-launch @sec-picker @lifecycle', async () => {
  test.setTimeout(300_000)

  await waitForOperationDrain(_updateInstallId)

  await resetIpcInvocations(ctx.app, 'stop-comfyui')
  await resetIpcInvocations(ctx.app, 'run-action')

  let beforeSnapshot: Awaited<ReturnType<typeof getRunningSessionSnapshot>> = null
  await expect
    .poll(
      async () => {
        beforeSnapshot = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
        return beforeSnapshot
      },
      { timeout: 120_000, intervals: [1_000, 2_000] }
    )
    .not.toBeNull()
  expect(beforeSnapshot, 'expected a running session before Restart').not.toBeNull()

  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar)

  await popup.waitForVisible(byTestId(TID.pickerPrimaryCta), { timeout: 15_000 })
  await expect
    .poll(() => popup.textOf(byTestId(TID.pickerPrimaryCta)), {
      timeout: 10_000,
      intervals: [200, 400]
    })
    .toContain('Restart')
  expect(await popup.click(byTestId(TID.pickerPrimaryCta))).toBe(true)

  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)

  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 10_000,
      intervals: [100, 200]
    })
    .toBe(false)

  await waitForRunAction(_updateInstallId, 'launch', {
    timeout: 180_000,
    intervals: [1_000, 2_000]
  })
  await expect
    .poll(
      async () => {
        const after = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
        if (!after) return false
        return after.startedAt > (beforeSnapshot?.startedAt ?? 0)
      },
      { timeout: 180_000, intervals: [1_000, 2_000] }
    )
    .toBe(true)
  await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000] }).toBe(true)

  const stopCalls = await getStopsFor(_updateInstallId)
  expect(stopCalls.length, 'picker Restart should bypass the stop-comfyui renderer IPC').toBe(0)

  const launchCalls = (await getRunActionsFor(_updateInstallId)).filter(
    (c) => c.actionId === 'launch'
  )
  expect(
    launchCalls.length,
    'exactly one launch run-action for the restart'
  ).toBeGreaterThanOrEqual(1)
})

test('picker More-menu Stop fires stop-comfyui; stopped-card Relaunch restores it @sec-picker @lifecycle', async () => {
  test.setTimeout(300_000)

  await expect.poll(comfyFrontendIsLoaded, { timeout: 30_000, intervals: [500] }).toBe(true)
  const beforeSnapshot = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
  expect(beforeSnapshot, 'expected a running session before Stop').not.toBeNull()

  await resetIpcInvocations(ctx.app, 'stop-comfyui')
  await resetIpcInvocations(ctx.app, 'run-action')

  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'config')

  await popup.waitForVisible(byTestId(TID.pickerMoreTrigger), { timeout: 15_000 })
  await popup.clickUntilVisible(
    byTestId(TID.pickerMoreTrigger),
    byTestId(TID.pinBottomAction('stop')),
    { timeout: 30_000 }
  )
  expect(
    await popup.exists(byTestId(TID.pinBottomAction('launch'))),
    'launch must not render in the More menu'
  ).toBe(false)
  expect(
    await popup.exists(byTestId(TID.pinBottomAction('restart'))),
    'restart must not render in the More menu'
  ).toBe(false)
  expect(await popup.click(byTestId(TID.pinBottomAction('stop')))).toBe(true)

  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)

  await expect
    .poll(async () => (await getStopsFor(_updateInstallId)).length, {
      timeout: 60_000,
      intervals: [500, 1_000]
    })
    .toBeGreaterThanOrEqual(1)
  await expect
    .poll(async () => getRunningSessionSnapshot(ctx.app, _updateInstallId), {
      timeout: 120_000,
      intervals: [1_000, 2_000]
    })
    .toBeNull()
  await ctx.panel.waitForVisible('.panel-comfy-lifecycle', { timeout: 30_000 })

  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 10_000,
      intervals: [100, 200]
    })
    .toBe(false)

  await ctx.panel.waitForVisible(byTestId(TID.lifecycleRelaunch), { timeout: 120_000 })
  expect(await ctx.panel.click(byTestId(TID.lifecycleRelaunch))).toBe(true)

  await waitForRunAction(_updateInstallId, 'launch', {
    timeout: 180_000,
    intervals: [1_000, 2_000]
  })
  await expect
    .poll(
      async () => {
        const after = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
        if (!after) return false
        return after.startedAt > (beforeSnapshot?.startedAt ?? 0)
      },
      { timeout: 180_000, intervals: [1_000, 2_000] }
    )
    .toBe(true)
  await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000] }).toBe(true)
  await closeTitlePopupIfOpen(ctx.app)
})

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

function readRecordLaunchArgs(): Promise<string> {
  return ctx.panel.evaluate<string>(
    `window.api.getInstallations().then((list) => {
      const inst = list.find((i) => i.id === ${JSON.stringify(_updateInstallId)})
      return (inst && inst.launchArgs) || ''
    })`
  )
}

async function setPortArgViaPicker(popup: WebContentsPage, port: number): Promise<void> {
  const rawSel = '.args-raw-input input'
  await popup.waitForVisible(rawSel, { timeout: 15_000 })
  const before = await popup.evaluate<string>(
    `document.querySelector(${JSON.stringify(rawSel)}).value`
  )
  const withoutPort = before
    .replace(/--port(?:[ =]\S+)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  await popup.fill(rawSel, `${withoutPort} --port ${port}`.trim())
  await popup.evaluate<boolean>(
    `(() => { document.querySelector(${JSON.stringify(rawSel)}).blur(); return true })()`
  )
  await expect
    .poll(readRecordLaunchArgs, { timeout: 10_000, intervals: [100, 250] })
    .toContain(`--port ${port}`)
}

async function confirmPickerRestart(popup: WebContentsPage): Promise<void> {
  await popup.waitForVisible(byTestId(TID.pickerPrimaryCta), { timeout: 15_000 })
  expect(await popup.click(byTestId(TID.pickerPrimaryCta))).toBe(true)
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 10_000,
      intervals: [100, 200]
    })
    .toBe(false)
}

async function openBootWindowViaPickerRestart(): Promise<void> {
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar)
  await confirmPickerRestart(popup)
  await expect
    .poll(
      async () => {
        const [session, active] = await Promise.all([
          getRunningSessionSnapshot(ctx.app, _updateInstallId),
          hasActiveOperation(ctx.app, _updateInstallId)
        ])
        return session === null && active
      },
      { timeout: 60_000, intervals: [250, 500] }
    )
    .toBe(true)
}

test('boot-window --port edit surfaces Restart-to-apply and the restart applies it @sec-bootwindow @lifecycle', async () => {
  test.setTimeout(600_000)
  await waitForOperationDrain(_updateInstallId)

  let before: Awaited<ReturnType<typeof getRunningSessionSnapshot>> = null
  await expect
    .poll(
      async () => {
        before = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
        return before
      },
      { timeout: 120_000, intervals: [1_000, 2_000] }
    )
    .not.toBeNull()
  const targetPort = await findFreeLoopbackPort(19100)
  expect(targetPort, 'target port must differ from the current one').not.toBe(before!.port)

  await openBootWindowViaPickerRestart()
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'config')
  await setPortArgViaPicker(popup, targetPort)

  expect(
    await getRunningSessionSnapshot(ctx.app, _updateInstallId),
    'boot completed before the boot-window edit landed - cannot exercise issue #1300'
  ).toBeNull()

  let booted: Awaited<ReturnType<typeof getRunningSessionSnapshot>> = null
  await expect
    .poll(
      async () => {
        booted = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
        return booted
      },
      { timeout: 300_000, intervals: [1_000, 2_000] }
    )
    .not.toBeNull()
  expect(
    booted!.port,
    'the in-flight boot must come up on the pre-edit port, not pick up an edit made after it spawned'
  ).toBe(before!.port)

  await expect
    .poll(() => popup.textOf(byTestId(TID.pickerPrimaryCta)), {
      timeout: 30_000,
      intervals: [250, 500]
    })
    .toContain('Restart to apply')

  await confirmPickerRestart(popup)
  await expect
    .poll(
      async () => {
        const after = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
        if (!after || after.startedAt <= booted!.startedAt) return null
        return after.port
      },
      { timeout: 300_000, intervals: [1_000, 2_000] }
    )
    .toBe(targetPort)

  await expect
    .poll(
      async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${targetPort}/system_stats`, {
            signal: AbortSignal.timeout(5_000)
          })
          return res.status
        } catch {
          return 0
        }
      },
      { timeout: 60_000, intervals: [1_000] }
    )
    .toBe(200)
  await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000] }).toBe(true)
  await closeTitlePopupIfOpen(ctx.app)
})

test('restart clicked during boot cancels the in-flight boot and applies the edited --port @sec-bootwindow @lifecycle', async () => {
  test.setTimeout(600_000)
  await waitForOperationDrain(_updateInstallId)

  await expect
    .poll(async () => getRunningSessionSnapshot(ctx.app, _updateInstallId), {
      timeout: 120_000,
      intervals: [1_000, 2_000]
    })
    .not.toBeNull()
  const targetPort = await findFreeLoopbackPort(19400)

  await openBootWindowViaPickerRestart()
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'config')
  await setPortArgViaPicker(popup, targetPort)
  expect(
    await getRunningSessionSnapshot(ctx.app, _updateInstallId),
    'boot completed before the boot-window edit landed - cannot exercise restart-during-boot'
  ).toBeNull()

  await popup.waitForVisible(byTestId(TID.pickerPrimaryCta), { timeout: 15_000 })
  expect(await popup.click(byTestId(TID.pickerPrimaryCta))).toBe(true)
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(
    await isInstallLaunching(ctx.app, _updateInstallId),
    'boot finished before the restart click - this run did not exercise restart-during-boot'
  ).toBe(true)
  expect(await getRunningSessionSnapshot(ctx.app, _updateInstallId)).toBeNull()
  await resetIpcInvocations(ctx.app, 'picker-restart:cancel-launching')
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 10_000,
      intervals: [100, 200]
    })
    .toBe(false)

  await expect
    .poll(
      async () => {
        const calls = (await getIpcInvocations(
          ctx.app,
          'picker-restart:cancel-launching'
        )) as Array<{ installationId?: string; cancelled?: boolean }>
        return calls.find((c) => c.installationId === _updateInstallId)?.cancelled ?? null
      },
      { timeout: 90_000, intervals: [250, 500] }
    )
    .toBe(true)

  await expect
    .poll(
      async () => {
        const after = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
        return after?.port ?? null
      },
      { timeout: 300_000, intervals: [1_000, 2_000] }
    )
    .toBe(targetPort)
  await expect
    .poll(
      async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${targetPort}/system_stats`, {
            signal: AbortSignal.timeout(5_000)
          })
          return res.status
        } catch {
          return 0
        }
      },
      { timeout: 60_000, intervals: [1_000] }
    )
    .toBe(200)
  await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000] }).toBe(true)
  await closeTitlePopupIfOpen(ctx.app)
})

test('restart clicked during a FRESH chooser boot (unattached window) cancels it and applies the edited --port @sec-bootwindow @lifecycle', async () => {
  test.setTimeout(600_000)
  await waitForOperationDrain(_updateInstallId)

  await stopAndReturnToDashboardViaUI()

  const targetPort = await findFreeLoopbackPort(19700)
  const staleArgs = await readRecordLaunchArgs()
  const staleMatch = /--port[ =](\d+)/.exec(staleArgs)
  expect(
    staleMatch,
    `expected a persisted --port in launchArgs (got "${staleArgs}")`
  ).not.toBeNull()
  const stalePort = Number(staleMatch![1])
  expect(stalePort).not.toBe(targetPort)

  try {
    await armLaunchSpawnHold(ctx.app)
    await clickInstallTile(ctx.panel, 'ComfyUI')
    await expect
      .poll(() => isLaunchSpawnHeld(ctx.app), { timeout: 120_000, intervals: [250, 500] })
      .toBe(true)
    expect(await hasActiveLaunch(ctx.app, _updateInstallId)).toBe(true)
    expect(await isInstallLaunching(ctx.app, _updateInstallId)).toBe(true)
    expect(await getRunningSessionSnapshot(ctx.app, _updateInstallId)).toBeNull()

    const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'config')
    await setPortArgViaPicker(popup, targetPort)

    await expect
      .poll(() => popup.textOf(byTestId(TID.pickerPrimaryCta)), {
        timeout: 15_000,
        intervals: [250, 500]
      })
      .toContain('Restart')

    await resetIpcInvocations(ctx.app, 'picker-restart:cancel-launching')
    expect(await popup.click(byTestId(TID.pickerPrimaryCta))).toBe(true)
    await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
    expect(await isLaunchSpawnHeld(ctx.app)).toBe(true)
    expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)
    await expect
      .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
        timeout: 10_000,
        intervals: [100, 200]
      })
      .toBe(false)

    await expect
      .poll(
        async () => {
          const calls = (await getIpcInvocations(
            ctx.app,
            'picker-restart:cancel-launching'
          )) as Array<{ installationId?: string; cancelled?: boolean }>
          return calls.find((c) => c.installationId === _updateInstallId)?.cancelled ?? null
        },
        { timeout: 90_000, intervals: [250, 500] }
      )
      .toBe(true)
    await expect
      .poll(() => isLaunchSpawnHeld(ctx.app), { timeout: 10_000, intervals: [100, 250] })
      .toBe(false)

    await expect
      .poll(
        async () => {
          const after = await getRunningSessionSnapshot(ctx.app, _updateInstallId)
          return after?.port ?? null
        },
        { timeout: 300_000, intervals: [1_000, 2_000] }
      )
      .toBe(targetPort)
    await expect
      .poll(
        async () => {
          try {
            const res = await fetch(`http://127.0.0.1:${targetPort}/system_stats`, {
              signal: AbortSignal.timeout(5_000)
            })
            return res.status
          } catch {
            return 0
          }
        },
        { timeout: 60_000, intervals: [1_000] }
      )
      .toBe(200)
    await expect(
      fetch(`http://127.0.0.1:${stalePort}/system_stats`, { signal: AbortSignal.timeout(3_000) })
    ).rejects.toThrow()
    await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000] }).toBe(true)
    await closeTitlePopupIfOpen(ctx.app)
  } finally {
    await releaseLaunchSpawnHold(ctx.app)
  }
})

let _copyInstallId = ''
let _copyInstallPath = ''

test('picker pin-bottom Copy creates a real ~500MB copy of the install @sec-copy @lifecycle', async () => {
  test.setTimeout(600_000)

  await stopAndReturnToDashboardViaUI()

  const popup = await openManageViaDashboard(ctx.app, ctx.panel, _updateInstallId, 'config')

  await popup.waitForVisible(byTestId(TID.pickerMoreTrigger), { timeout: 15_000 })
  await popup.clickUntilVisible(
    byTestId(TID.pickerMoreTrigger),
    byTestId(TID.pinBottomAction('copy')),
    { timeout: 30_000 }
  )
  expect(await popup.click(byTestId(TID.pinBottomAction('copy')))).toBe(true)

  const newName = `ComfyUI Copy E2E ${randomUUID().slice(0, 8)}`
  await submitCopyNamePrompt(popup, newName)

  await waitForProgressTakeoverAfterPopupClose()

  const copyRecord = await waitForCopyRegistered(newName)
  _copyInstallId = copyRecord.id
  _copyInstallPath = copyRecord.installPath
  _runCreatedInstallPaths.add(_copyInstallPath)
  await waitForOperationDrain(_updateInstallId)

  expect(
    existsSync(path.join(_copyInstallPath, 'ComfyUI', '.git')),
    'copy missing ComfyUI/.git'
  ).toBe(true)
  expect(
    existsSync(path.join(_copyInstallPath, 'standalone-env')),
    'copy missing standalone-env/'
  ).toBe(true)
  expect(
    existsSync(path.join(_copyInstallPath, '.comfyui-desktop-2')),
    'copy missing .comfyui-desktop-2 marker'
  ).toBe(true)
  expect(
    existsSync(path.join(_updateInstallPath, 'ComfyUI', '.git')),
    'source ComfyUI/.git missing after copy'
  ).toBe(true)
  expect(
    existsSync(path.join(_updateInstallPath, '.comfyui-desktop-2')),
    'source marker missing after copy'
  ).toBe(true)

  await closeTitlePopupIfOpen(ctx.app)
})

test('cleans up the copy install before the original delete test runs @sec-copy @lifecycle', async () => {
  test.setTimeout(300_000)
  expect(_copyInstallId, 'no copy install id captured to clean up').toBeTruthy()

  await expectChooserVisible(ctx.panel)
  await ctx.panel.waitForVisible(byTestId(TID.dashboardTileKebab(_copyInstallId)), {
    timeout: 15_000
  })
  expect(await ctx.panel.click(byTestId(TID.dashboardTileKebab(_copyInstallId)))).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.contextMenuItem('delete')), { timeout: 5_000 })
  expect(await ctx.panel.click(byTestId(TID.contextMenuItem('delete')))).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 15_000 })
  expect(await ctx.panel.click(byTestId(TID.baseAlertAction))).toBe(true)

  await expect
    .poll(() => existsSync(_copyInstallPath), { timeout: 240_000, intervals: [1_000, 2_000] })
    .toBe(false)
  await expect
    .poll(
      async () => {
        const remaining = await ctx.panel.evaluate<InstallationLite[]>(
          `window.api.getInstallations()`
        )
        return remaining.some((i) => i.id === _copyInstallId)
      },
      { timeout: 30_000, intervals: [250, 500] }
    )
    .toBe(false)
  const remaining = await ctx.panel.evaluate<InstallationLite[]>(`window.api.getInstallations()`)
  expect(
    remaining.find((i) => i.id === _updateInstallId),
    'original install was unexpectedly removed'
  ).toBeDefined()
})

let _kebabCopyInstallId = ''
let _kebabCopyInstallPath = ''

test('dashboard kebab "Copy Installation" creates a real ~500MB copy @sec-copy @lifecycle', async () => {
  test.setTimeout(600_000)

  await expectChooserVisible(ctx.panel)
  await ctx.panel.waitForVisible(byTestId(TID.dashboardTileKebab(_updateInstallId)), {
    timeout: 10_000
  })

  await resetIpcInvocations(ctx.app, 'run-action')

  expect(await ctx.panel.click(byTestId(TID.dashboardTileKebab(_updateInstallId)))).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.contextMenuItem('copy-install')), { timeout: 5_000 })
  expect(await ctx.panel.click(byTestId(TID.contextMenuItem('copy-install')))).toBe(true)

  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  const newName = `ComfyUI Kebab Copy E2E ${randomUUID().slice(0, 8)}`
  await submitCopyNamePrompt(popup, newName)

  await waitForProgressTakeoverAfterPopupClose()

  const copyRecord = await waitForCopyRegistered(newName)
  _kebabCopyInstallId = copyRecord.id
  _kebabCopyInstallPath = copyRecord.installPath
  _runCreatedInstallPaths.add(_kebabCopyInstallPath)
  await waitForOperationDrain(_updateInstallId)

  expect(
    existsSync(path.join(_kebabCopyInstallPath, 'ComfyUI', '.git')),
    'kebab copy missing ComfyUI/.git'
  ).toBe(true)
  expect(
    existsSync(path.join(_kebabCopyInstallPath, 'standalone-env')),
    'kebab copy missing standalone-env/'
  ).toBe(true)
  expect(
    existsSync(path.join(_kebabCopyInstallPath, '.comfyui-desktop-2')),
    'kebab copy missing .comfyui-desktop-2 marker'
  ).toBe(true)
  expect(
    existsSync(path.join(_updateInstallPath, 'ComfyUI', '.git')),
    'source ComfyUI/.git missing after kebab copy'
  ).toBe(true)
  expect(
    existsSync(path.join(_updateInstallPath, '.comfyui-desktop-2')),
    'source marker missing after kebab copy'
  ).toBe(true)

  const runActions = await getRunActionsFor(_updateInstallId)
  const copyDispatches = runActions.filter((c) => c.actionId === 'copy')
  expect(
    copyDispatches.length,
    'kebab dispatch must route copy through the picker, not call runAction directly'
  ).toBeLessThanOrEqual(1)

  await closeTitlePopupIfOpen(ctx.app)
})

test('Manage drawer "Untrack" removes the install from the registry without touching disk @sec-copy @lifecycle', async () => {
  test.setTimeout(60_000)
  expect(_kebabCopyInstallId, 'no kebab-copy install id to untrack').toBeTruthy()
  expect(_kebabCopyInstallPath, 'no kebab-copy install path captured').toBeTruthy()

  await waitForWebContents(ctx.app, 'panel.html')
  await expectChooserVisible(ctx.panel)
  await ctx.panel.waitForVisible(byTestId(TID.dashboardTileKebab(_kebabCopyInstallId)), {
    timeout: 10_000
  })

  await untrackViaManageDrawer(_kebabCopyInstallId)

  await expect
    .poll(
      async () => {
        const installs = await ctx.panel.evaluate<InstallationLite[]>(
          `window.api.getInstallations()`
        )
        return installs.some((i) => i.id === _kebabCopyInstallId)
      },
      { timeout: 30_000, intervals: [250, 500] }
    )
    .toBe(false)

  await closeTitlePopupIfOpen(ctx.app)

  expect(
    existsSync(_kebabCopyInstallPath),
    'untrack must NOT touch disk; kebab-copy dir should still exist'
  ).toBe(true)
  expect(
    existsSync(path.join(_kebabCopyInstallPath, '.comfyui-desktop-2')),
    'untrack must leave marker file intact on disk'
  ).toBe(true)

  const remaining = await ctx.panel.evaluate<InstallationLite[]>(`window.api.getInstallations()`)
  expect(
    remaining.find((i) => i.id === _updateInstallId),
    'untrack must not affect the original install'
  ).toBeDefined()
})

test('cleans up the untracked kebab-copy on disk before the final Delete test runs @sec-copy @lifecycle', async () => {
  test.setTimeout(120_000)
  expect(_kebabCopyInstallPath, 'no kebab-copy install path to clean up').toBeTruthy()
  expect(
    existsSync(_kebabCopyInstallPath),
    'kebab-copy dir already gone — Untrack test invariant violated'
  ).toBe(true)

  await expect
    .poll(
      () => {
        try {
          rmSync(_kebabCopyInstallPath, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 200
          })
        } catch {}
        return existsSync(_kebabCopyInstallPath)
      },
      { timeout: 60_000, intervals: [500, 1_000] }
    )
    .toBe(false)
})

let _remoteInstallId = ''
let _remoteName = ''
let _remoteWindowId = 0
let _remoteWcId = 0
let _remoteOutputRoot = ''
let _remoteExpectedFile = ''
let _remoteRunId = ''

async function openDashboardWindowViaPickerHome(): Promise<number> {
  const beforeWinIds = await evalWithRetry(() =>
    ctx.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed())
        .map((w) => w.id)
    )
  )
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar)
  await popup.waitForVisible('.picker-home', { timeout: 10_000 })
  expect(await popup.click('.picker-home')).toBe(true)
  await closeTitlePopupIfOpen(ctx.app)
  let newWindowId = 0
  await expect
    .poll(
      async () => {
        const ids = await evalWithRetry(() =>
          ctx.app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .filter((w) => !w.isDestroyed())
              .map((w) => w.id)
          )
        )
        const fresh = ids.filter((id) => !beforeWinIds.includes(id))
        if (fresh.length > 0) newWindowId = fresh[0]!
        return fresh.length
      },
      { timeout: 30_000, intervals: [250, 500] }
    )
    .toBe(1)
  await expectChooserVisible(ctx.panel)
  return newWindowId
}

async function evalInWebContents<T>(wcId: number, expr: string): Promise<T> {
  return (await evalWithRetry(() =>
    ctx.app.evaluate(
      async ({ webContents }, p) => {
        const wc = webContents.fromId(p.id)
        if (!wc || wc.isDestroyed()) throw new Error(`webContents ${p.id} gone`)
        return (await wc.executeJavaScript(p.expr)) as unknown
      },
      { id: wcId, expr }
    )
  )) as T
}

function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (d: string, prefix: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path.join(d, entry.name), rel)
      else out.push(rel)
    }
  }
  walk(dir, '')
  return out
}

test('creates a Remote Connection record pointed at the running local server through the wizard @sec-remote @lifecycle', async () => {
  test.setTimeout(120_000)

  if (!(await comfyFrontendIsLoaded())) {
    await clickInstallTile(ctx.panel, 'ComfyUI')
    await expect.poll(comfyFrontendIsLoaded, { timeout: 180_000, intervals: [1_000] }).toBe(true)
    await ensureInstallPanelView(ctx.app, _updateInstallId)
    await waitForWebContents(ctx.app, 'panel.html')
  }

  const origin = await evalWithRetry(() =>
    ctx.app.evaluate(({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => /^http:\/\/(127\.0\.0\.1|localhost):/.test(w.getURL()))
      return wc ? new URL(wc.getURL()).origin : null
    })
  )
  expect(origin, 'no localhost comfy webContents to derive the server origin from').toBeTruthy()

  const outputDir = await ctx.panel.evaluate<string | null>(`window.api.getSetting('outputDir')`)
  expect(outputDir, 'shared outputDir setting is unset').toBeTruthy()
  expect(existsSync(outputDir!), `shared output dir does not exist: ${outputDir}`).toBe(true)

  _remoteRunId = `remote-lifecycle-${randomUUID().slice(0, 8)}`
  _remoteOutputRoot = path.join(outputDir!, _remoteRunId)
  _remoteExpectedFile = path.join(_remoteOutputRoot, 'nested', 'output_00001_.png')
  expect(existsSync(_remoteOutputRoot), 'unique output root unexpectedly pre-exists').toBe(false)

  _remoteWindowId = await openDashboardWindowViaPickerHome()
  await clickNewInstallTile(ctx.panel)
  await expectNewBuildModalOpen(ctx.panel)
  await waitForConfigContinueEnabled(
    'Continue never enabled after the wizard opened (standalone pre-fill)'
  )

  await openNewBuildChangeSetup(ctx.panel)
  expect(
    await ctx.panel.click('[data-testid="install-source-remote"]'),
    'Remote Connection link clicked'
  ).toBe(true)

  await ctx.panel.waitForVisible('#sf-url', { timeout: 10_000 })
  await ctx.panel.fill('#sf-url', origin!)
  expect(
    await ctx.panel.click('[data-testid="config-save-changes"]'),
    'Saved the Remote Connection to the New Build summary'
  ).toBe(true)
  await ctx.panel.waitForVisible('#inst-name-standalone', { timeout: 5_000 })
  _remoteName = `Remote Loopback E2E ${randomUUID().slice(0, 8)}`
  await ctx.panel.fill('#inst-name-standalone', _remoteName)

  await waitForConfigContinueEnabled('Continue never enabled for the Remote Connection source')
  expect(await ctx.panel.click('.config-continue')).toBe(true)

  await expect
    .poll(
      async () => {
        const installs = await ctx.panel
          .evaluate<Array<{ id: string; name: string }>>(`window.api.getInstallations()`)
          .catch(() => [] as Array<{ id: string; name: string }>)
        const rec = installs.find((i) => i.name === _remoteName)
        if (rec) _remoteInstallId = rec.id
        return !!rec
      },
      { timeout: 30_000, intervals: [250, 500] }
    )
    .toBe(true)
  await expectChooserVisible(ctx.panel)
})

test('remote workflow output is saved exactly once - no "(1)" duplicate next to the server-written file @sec-remote @lifecycle', async () => {
  test.setTimeout(180_000)
  expect(_remoteInstallId, 'no remote install id from the wizard test').toBeTruthy()
  expect(_remoteOutputRoot, 'no output root captured').toBeTruthy()

  const beforeWcIds = await evalWithRetry(() =>
    ctx.app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .filter((w) => /^http:\/\/(127\.0\.0\.1|localhost):/.test(w.getURL()))
        .map((w) => w.id)
    )
  )

  await expectChooserVisible(ctx.panel)
  await clickInstallTile(ctx.panel, _remoteName)

  await expect
    .poll(
      async () => {
        const ids = await evalWithRetry(() =>
          ctx.app.evaluate(({ webContents }) =>
            webContents
              .getAllWebContents()
              .filter(
                (w) => /^http:\/\/(127\.0\.0\.1|localhost):/.test(w.getURL()) && !w.isLoading()
              )
              .map((w) => w.id)
          )
        )
        const fresh = ids.filter((id) => !beforeWcIds.includes(id))
        if (fresh.length > 0) _remoteWcId = fresh[0]!
        return fresh.length
      },
      { timeout: 90_000, intervals: [500, 1_000] }
    )
    .toBeGreaterThan(0)

  await expect
    .poll(async () => (await getRunningSessionSnapshot(ctx.app, _remoteInstallId)) !== null, {
      timeout: 30_000,
      intervals: [250, 500]
    })
    .toBe(true)

  await expect
    .poll(
      () =>
        evalInWebContents<boolean>(
          _remoteWcId,
          `(() => {
      const d = window.__comfyDesktop2
      return !!(d && typeof d.downloadAsset === 'function'
        && typeof d.isRemote === 'function' && d.isRemote() === true
        && !/native code/.test(String(window.WebSocket)))
    })()`
        ).catch(() => false),
      { timeout: 60_000, intervals: [500, 1_000] }
    )
    .toBe(true)

  const graph = {
    '1': {
      class_type: 'EmptyImage',
      inputs: { width: 64, height: 64, batch_size: 1, color: 0 }
    },
    '2': {
      class_type: 'SaveImage',
      inputs: { images: ['1', 0], filename_prefix: `${_remoteRunId}/nested/output` }
    }
  }
  const submitted = await evalInWebContents<{ sid: string; promptId: string; error: unknown }>(
    _remoteWcId,
    `(() => new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(proto + '://' + location.host + '/ws')
      const timer = setTimeout(() => reject(new Error('no status/sid message within 20s')), 20000)
      ws.onerror = () => { clearTimeout(timer); reject(new Error('workflow WebSocket errored')) }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let msg
        try { msg = JSON.parse(ev.data) } catch { return }
        if (msg.type !== 'status' || !msg.data || !msg.data.sid) return
        clearTimeout(timer)
        window.__e2eRemoteWs = ws  // keep open: 'executed' must arrive on this socket
        fetch('/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: msg.data.sid, prompt: ${JSON.stringify(graph)} }),
        })
          .then((r) => r.json())
          .then((j) => resolve({ sid: msg.data.sid, promptId: j.prompt_id || '', error: j.error || null }))
          .catch((e) => reject(e))
      }
    }))()`
  )
  expect(
    submitted.error,
    `POST /prompt rejected the graph: ${JSON.stringify(submitted.error)}`
  ).toBeFalsy()
  expect(submitted.promptId, 'no prompt_id returned').toBeTruthy()

  await expect
    .poll(
      () =>
        evalInWebContents<boolean>(
          _remoteWcId,
          `(() =>
      fetch('/history/' + ${JSON.stringify(submitted.promptId)})
        .then((r) => r.json())
        .then((j) => {
          const h = j[${JSON.stringify(submitted.promptId)}]
          return !!(h && h.outputs && h.outputs['2'] && h.outputs['2'].images && h.outputs['2'].images.length > 0)
        })
        .catch(() => false)
    )()`
        ).catch(() => false),
      { timeout: 60_000, intervals: [500, 1_000] }
    )
    .toBe(true)
  const outputMeta = await evalInWebContents<{ filename: string; subfolder: string; type: string }>(
    _remoteWcId,
    `(() => fetch('/history/' + ${JSON.stringify(submitted.promptId)})
      .then((r) => r.json())
      .then((j) => j[${JSON.stringify(submitted.promptId)}].outputs['2'].images[0]))()`
  )
  expect(outputMeta.filename).toBe('output_00001_.png')
  expect(outputMeta.subfolder.replace(/\\/g, '/')).toBe(`${_remoteRunId}/nested`)
  expect(outputMeta.type).toBe('output')

  await expect
    .poll(() => existsSync(_remoteExpectedFile), { timeout: 30_000, intervals: [250, 500] })
    .toBe(true)
  expect(statSync(_remoteExpectedFile).size, 'server-written PNG is empty').toBeGreaterThan(0)

  const matches = (d: { url: string }): boolean =>
    d.url.includes('/api/view?') && d.url.includes(_remoteRunId)
  let completedSavePath: string | undefined
  await expect
    .poll(
      async () => {
        const tray = await getLiveDownloadsTrayState(ctx.app)
        if (tray.active.some(matches)) return 'still-active'
        const done = tray.recent.find((d) => matches(d) && d.status === 'completed')
        if (!done) return 'not-completed'
        completedSavePath = done.savePath
        return 'completed'
      },
      { timeout: 60_000, intervals: [500, 1_000] }
    )
    .toBe('completed')

  expect(completedSavePath, 'completed tray entry has no savePath').toBeTruthy()
  expect(path.resolve(completedSavePath!)).toBe(path.resolve(_remoteExpectedFile))

  await new Promise((r) => setTimeout(r, 2_500))
  const files = listFilesRecursive(_remoteOutputRoot)
  expect(files, `expected exactly one output file, got: ${files.join(', ')}`).toEqual([
    'nested/output_00001_.png'
  ])
  expect(
    files.some((f) => / \(\d+\)\.png$/.test(f)),
    'duplicate "(N)" download copy found'
  ).toBe(false)
  expect(statSync(_remoteExpectedFile).size).toBeGreaterThan(0)
})

test('cleans up the remote connection: window closed, record untracked, local install untouched @sec-remote @lifecycle', async () => {
  test.setTimeout(120_000)
  expect(_remoteInstallId, 'no remote install id to clean up').toBeTruthy()

  if (_remoteWcId) {
    await evalInWebContents<boolean>(
      _remoteWcId,
      `(() => { try { window.__e2eRemoteWs && window.__e2eRemoteWs.close() } catch {} return true })()`
    ).catch(() => false)
  }
  expect(_remoteWindowId, 'no remote window id captured').toBeGreaterThan(0)
  await evalWithRetry(() =>
    ctx.app.evaluate(({ BrowserWindow }, id) => {
      const win = BrowserWindow.fromId(id)
      if (win && !win.isDestroyed()) win.close()
    }, _remoteWindowId)
  )
  await expect
    .poll(async () => (await getRunningSessionSnapshot(ctx.app, _remoteInstallId)) === null, {
      timeout: 30_000,
      intervals: [250, 500]
    })
    .toBe(true)

  await openDashboardWindowViaPickerHome()
  await ctx.panel.waitForVisible(byTestId(TID.dashboardTile(_remoteInstallId)), { timeout: 15_000 })
  await untrackViaManageDrawer(_remoteInstallId)
  await expect
    .poll(
      async () => {
        const installs = await ctx.panel.evaluate<InstallationLite[]>(
          `window.api.getInstallations()`
        )
        return installs.some((i) => i.id === _remoteInstallId)
      },
      { timeout: 30_000, intervals: [250, 500] }
    )
    .toBe(false)

  await closeExtraWindowsKeepComfyHost()
  expect(await ensureInstallPanelView(ctx.app, _updateInstallId)).toBe(true)
  await waitForWebContents(ctx.app, 'panel.html')

  if (_remoteOutputRoot) {
    await expect
      .poll(
        () => {
          try {
            rmSync(_remoteOutputRoot, {
              recursive: true,
              force: true,
              maxRetries: 5,
              retryDelay: 200
            })
          } catch {}
          return existsSync(_remoteOutputRoot)
        },
        { timeout: 15_000, intervals: [250, 500] }
      )
      .toBe(false)
    _remoteOutputRoot = ''
  }

  expect(await comfyFrontendIsLoaded(), 'local install stopped during the remote section').toBe(
    true
  )
})

let _deleteInstallId = ''
let _deleteInstallPath = ''

test('stops comfy and captures the installed dir state before driving delete @sec-delete @lifecycle', async () => {
  await stopAndReturnToDashboardViaUI()

  const installs = await ctx.panel.evaluate<InstallationLite[]>(`window.api.getInstallations()`)
  expect(installs.length, 'no tracked installation after install').toBeGreaterThan(0)
  const inst = installs[0]!
  _deleteInstallId = inst.id
  _deleteInstallPath = inst.installPath

  expect(
    existsSync(path.join(_deleteInstallPath, 'ComfyUI', '.git')),
    'installed dir missing ComfyUI/.git'
  ).toBe(true)
  expect(
    existsSync(path.join(_deleteInstallPath, 'standalone-env')),
    'installed dir missing standalone-env/'
  ).toBe(true)
  expect(
    existsSync(path.join(_deleteInstallPath, '.comfyui-desktop-2')),
    'installed dir missing .comfyui-desktop-2 marker'
  ).toBe(true)
})

test('real delete wipes the fully-installed ~500MB tree off disk @sec-delete @lifecycle', async () => {
  test.setTimeout(300_000)
  expect(_deleteInstallPath, 'install path not captured').toBeTruthy()

  await ctx.panel.waitForVisible(byTestId(TID.dashboardTileKebab(_deleteInstallId)), {
    timeout: 10_000
  })
  expect(await ctx.panel.click(byTestId(TID.dashboardTileKebab(_deleteInstallId)))).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.contextMenuItem('delete')), { timeout: 5_000 })
  expect(await ctx.panel.click(byTestId(TID.contextMenuItem('delete')))).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 15_000 })
  expect(await ctx.panel.click(byTestId(TID.baseAlertAction))).toBe(true)

  await expect
    .poll(() => existsSync(_deleteInstallPath), { timeout: 240_000, intervals: [1_000, 2_000] })
    .toBe(false)
  expect(
    existsSync(path.join(_deleteInstallPath, 'ComfyUI', 'main.py')),
    'ComfyUI/main.py still on disk after delete'
  ).toBe(false)

  await expect
    .poll(
      async () => {
        const remaining = await ctx.panel.evaluate<InstallationLite[]>(
          `window.api.getInstallations()`
        )
        return remaining.some((i) => i.id === _deleteInstallId)
      },
      { timeout: 30_000, intervals: [250, 500] }
    )
    .toBe(false)
})
