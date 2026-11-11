import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { test } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'

import { evalWithRetry } from './evalRetry'
import { FOREGROUND_PROJECTS, isBackgroundRun } from './focusMode'

export interface LauncherAppHandle {
  application: ElectronApplication
  homeDir: string
  cleanup: () => Promise<void>
}

export interface SeedOptions {
  installations?: SeedInstallation[]
  settings?: Record<string, unknown>
  onSetup?: (paths: { homeDir: string; appDataDir: string }) => Promise<void>
  opsFlags?: Record<string, unknown>
  profileDir?: string
}

export interface SeedInstallation {
  id?: string
  name?: string
  sourceId?: string
  installPath?: string
  status?: string
  snapshots?: SeedSnapshot[]
  [key: string]: unknown
}

export interface SeedSnapshot {
  version?: 1
  createdAt?: string
  trigger: 'boot' | 'restart' | 'manual' | 'pre-update' | 'post-update' | 'post-restore'
  label?: string | null
  comfyui: {
    ref: string
    commit: string | null
    releaseTag: string
    variant: string
    baseTag?: string
    commitsAhead?: number
  }
  customNodes?: unknown[]
  pipPackages?: Record<string, string>
  pythonVersion?: string
  updateChannel?: string
  skipPipSync?: boolean
}

function formatSeedTimestamp(date: Date): string {
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${pad(date.getMilliseconds(), 3)}`
}

function buildIsolatedEnv(
  homeDir: string,
  settingsSeed?: Record<string, unknown>,
  opsFlagsSeed?: Record<string, unknown>
): Record<string, string> {
  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )

  const env: Record<string, string> = {
    ...inheritedEnv,
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
    XDG_CACHE_HOME: path.join(homeDir, '.cache'),
    XDG_DATA_HOME: path.join(homeDir, '.local', 'share'),
    XDG_STATE_HOME: path.join(homeDir, '.local', 'state'),
    E2E: '1'
  }

  if (process.platform === 'win32') {
    env['APPDATA'] = path.join(homeDir, 'AppData', 'Roaming')
    env['LOCALAPPDATA'] = path.join(homeDir, 'AppData', 'Local')
  }

  if (process.platform === 'darwin') {
    env['CFFIXED_USER_HOME'] = homeDir
  }

  const effectiveSeed: Record<string, unknown> = {
    firstUseCompleted: false,
    telemetryEnabled: false,
    ...(settingsSeed ?? {})
  }
  env['E2E_SETTINGS_SEED'] = JSON.stringify(effectiveSeed)

  if (opsFlagsSeed) env['E2E_OPS_FLAGS_SEED'] = JSON.stringify(opsFlagsSeed)

  return env
}

export async function launchLauncherApp(options?: SeedOptions): Promise<LauncherAppHandle> {
  const reuseDir = options?.profileDir ?? process.env['NIGHTLY_REUSE_DIR']
  const homeDir = reuseDir
    ? path.resolve(reuseDir)
    : await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-e2e-'))
  if (reuseDir) {
    console.log(`[e2e-harness] reusing profile dir: ${homeDir}`)
  } else {
    console.log(`[e2e-harness] fresh profile dir: ${homeDir}`)
    console.log(
      `[e2e-harness] re-export as NIGHTLY_REUSE_DIR=${homeDir} to rerun individual tests against this profile`
    )
  }

  const appDataDir =
    process.platform === 'win32'
      ? path.join(homeDir, 'AppData', 'Roaming', 'comfyui-desktop-2')
      : process.platform === 'darwin'
        ? path.join(homeDir, 'Library', 'Application Support', 'comfyui-desktop-2')
        : path.join(homeDir, '.config', 'comfyui-desktop-2')
  await mkdir(appDataDir, { recursive: true })

  if (options?.onSetup) {
    await options.onSetup({ homeDir, appDataDir })
  }

  const seedRecords = (options?.installations ?? []).map((inst, i) => {
    const { snapshots: _snapshots, ...rest } = inst
    return {
      id: inst.id ?? `inst-test-${i}`,
      name: inst.name ?? `Test Install ${i + 1}`,
      createdAt: new Date().toISOString(),
      installPath: inst.installPath ?? path.join(homeDir, `install-${i}`),
      sourceId: inst.sourceId ?? 'standalone',
      status: inst.status ?? 'installed',
      ...rest
    }
  })

  for (const record of seedRecords) {
    if (!record.installPath) continue
    try {
      await stat(record.installPath)
    } catch {
      continue
    }
    await mkdir(path.join(record.installPath, '.launcher'), { recursive: true })
  }

  if (options?.installations) {
    const { writeFile: writeFileFs } = await import('node:fs/promises')
    for (let i = 0; i < options.installations.length; i++) {
      const snaps = options.installations[i]!.snapshots
      if (!snaps || snaps.length === 0) continue
      const installPath = seedRecords[i]!.installPath
      const snapshotsDir = path.join(installPath, '.launcher', 'snapshots')
      await mkdir(snapshotsDir, { recursive: true })
      for (let j = 0; j < snaps.length; j++) {
        const s = snaps[j]!
        const createdAt =
          s.createdAt ?? new Date(Date.now() - (snaps.length - j) * 1000).toISOString()
        const full = {
          version: 1,
          createdAt,
          trigger: s.trigger,
          label: s.label ?? null,
          comfyui: s.comfyui,
          customNodes: s.customNodes ?? [],
          pipPackages: s.pipPackages ?? {},
          pythonVersion: s.pythonVersion,
          updateChannel: s.updateChannel ?? 'stable',
          ...(s.skipPipSync ? { skipPipSync: true } : {})
        }
        const filename = `${formatSeedTimestamp(new Date(createdAt))}-${s.trigger}-${(j + 1).toString(16).padStart(6, '0')}.json`
        await writeFileFs(path.join(snapshotsDir, filename), JSON.stringify(full, null, 2))
      }
    }
  }

  const args = ['.']
  if (isBackgroundRun() && !FOREGROUND_PROJECTS.includes(test.info().project.name)) {
    args.unshift(
      '-r',
      path.resolve('e2e/support/backgroundShim.cjs'),
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows'
    )
  }
  if (process.platform === 'linux') {
    args.push('--no-sandbox')
    const ozone = process.env['E2E_OZONE_PLATFORM']
    if (ozone) args.push(`--ozone-platform=${ozone}`)
  }

  let persistedSettings: Record<string, unknown> = {}
  if (reuseDir) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(path.join(appDataDir, 'settings.json'), 'utf-8')
      )
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        persistedSettings = parsed as Record<string, unknown>
      }
    } catch {}
    delete persistedSettings['telemetryEnabled']
  }
  const env = buildIsolatedEnv(
    homeDir,
    { ...persistedSettings, ...(options?.settings ?? {}) },
    options?.opsFlags
  )
  if (seedRecords.length > 0) {
    env['E2E_INSTALLATIONS_SEED'] = JSON.stringify(seedRecords)
  }

  const application = await electron.launch({
    args,
    env
  })

  const page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await evalWithRetry(() =>
    application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isVisible()) win.show()
    })
  )

  await evalWithRetry(() =>
    application.evaluate(({ app: electronApp, dialog }) => {
      dialog.showErrorBox = () => {}
      const marked = electronApp as typeof electronApp & {
        __e2eRenderProcessGoneInstalled?: boolean
      }
      if (!marked.__e2eRenderProcessGoneInstalled) {
        marked.__e2eRenderProcessGoneInstalled = true
        electronApp.on('render-process-gone', () => electronApp.exit(1))
      }
    })
  )

  const cleanup = async (): Promise<void> => {
    try {
      const proc = application.process()
      if (proc && proc.exitCode === null) {
        await application.close().catch(() => {})
      }
    } catch {}
    if (!reuseDir) {
      await rm(homeDir, { recursive: true, force: true })
    }
  }

  return { application, homeDir, cleanup }
}

export async function waitForAppExit(
  application: ElectronApplication,
  timeoutMs = 10_000
): Promise<void> {
  const child = application.process()
  if (child.exitCode !== null) return

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      reject(new Error(`Electron app did not exit within ${timeoutMs}ms`))
    }, timeoutMs)

    const onExit = (): void => {
      clearTimeout(timer)
      resolve()
    }

    child.once('exit', onExit)
  })
}
