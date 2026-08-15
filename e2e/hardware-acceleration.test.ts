import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { openTitleMenu } from './support/chooserHelpers'
import { titlePopupPage } from './support/cdpPages'

const MIB = 1024 * 1024
const GPU_MEMORY_COUNTER = '\\GPU Process Memory(*)\\Dedicated Usage'

function runPowerShell(script: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf-8',
    timeout: 15_000,
    windowsHide: true
  }).trim()
}

function hasNvidiaGpu(): boolean {
  try {
    const output = execFileSync('nvidia-smi', ['-L'], {
      encoding: 'utf-8',
      timeout: 15_000,
      windowsHide: true
    })
    return /GPU \d+:/.test(output)
  } catch {
    return false
  }
}

function canReadDedicatedGpuMemory(): boolean {
  try {
    const count = runPowerShell(
      `$ErrorActionPreference = 'Stop'; ` +
        `$samples = (Get-Counter '${GPU_MEMORY_COUNTER}').CounterSamples; ` +
        `[Console]::Write($samples.Count)`
    )
    return Number.parseInt(count, 10) > 0
  } catch {
    return false
  }
}

async function getElectronProcessIds(application: ElectronApplication): Promise<number[]> {
  return application.evaluate(({ app }) => app.getAppMetrics().map((metric) => metric.pid))
}

function readDedicatedGpuMemory(processIds: number[]): number {
  const ids = processIds.filter((pid) => Number.isInteger(pid) && pid > 0).join(',')
  if (!ids) return 0

  const output = runPowerShell(
    `$ErrorActionPreference = 'Stop'; ` +
      `$ids = @(${ids}); ` +
      `$samples = (Get-Counter '${GPU_MEMORY_COUNTER}').CounterSamples; ` +
      `$total = ($samples | Where-Object { ` +
      `$_.InstanceName -match '^pid_([0-9]+)_' -and $ids -contains [int]$Matches[1] ` +
      `} | Measure-Object CookedValue -Sum).Sum; ` +
      `if ($null -eq $total) { $total = 0 }; ` +
      `[Console]::Write([long]$total)`
  )
  const bytes = Number.parseInt(output, 10)
  if (!Number.isFinite(bytes)) throw new Error(`Invalid GPU memory counter result: ${output}`)
  return bytes
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

async function sampleGpuMemory(application: ElectronApplication): Promise<number[]> {
  await new Promise((resolve) => setTimeout(resolve, 2_000))
  const samples: number[] = []
  for (let i = 0; i < 5; i++) {
    samples.push(readDedicatedGpuMemory(await getElectronProcessIds(application)))
    if (i < 4) await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return samples
}

async function measureApp(application: ElectronApplication): Promise<{
  samples: number[]
  gpuCompositing: string
}> {
  const samples = await sampleGpuMemory(application)
  const gpuCompositing = await application.evaluate(
    ({ app: electronApp }) => electronApp.getGPUFeatureStatus().gpu_compositing
  )
  return { samples, gpuCompositing }
}

async function disableHardwareAccelerationFromDesktopSettings(ctx: AppContext): Promise<void> {
  const popup = titlePopupPage(ctx.app)
  await openTitleMenu(ctx.titleBar)
  await popup.waitForVisible('[role="menuitem"]', { timeout: 5_000 })
  expect(await popup.clickByText('[role="menuitem"]', 'Desktop Settings')).toBe(true)
  await popup.waitForVisible('.global-settings', { timeout: 5_000 })

  const selector = '[role="switch"][aria-label="Use hardware acceleration"]'
  await popup.waitForVisible(selector, { timeout: 5_000 })
  expect(
    await popup.evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-checked')`
    )
  ).toBe('true')
  expect(await popup.allText('.settings-v2-field-description')).toContain(
    'Uses the GPU to render Comfy Desktop. Restart Comfy Desktop for changes to take effect.'
  )
  expect(await popup.click(selector)).toBe(true)
  await popup.waitFor(
    async () =>
      (await popup.evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-checked')`
      )) === 'false',
    { timeout: 5_000, message: 'hardware acceleration toggle did not switch off' }
  )
}

test('disabling hardware acceleration reduces Desktop VRAM use @windows', async () => {
  test.skip(process.platform !== 'win32', 'Windows exposes per-process dedicated GPU memory')
  test.skip(!hasNvidiaGpu(), 'An NVIDIA GPU and nvidia-smi are required')
  test.skip(
    !canReadDedicatedGpuMemory(),
    'The Windows GPU Process Memory performance counter is unavailable'
  )
  test.setTimeout(90_000)

  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'comfyui-hardware-acceleration-e2e-'))
  let accelerated: Awaited<ReturnType<typeof measureApp>>
  let disabled: Awaited<ReturnType<typeof measureApp>>
  try {
    const acceleratedCtx = await launchApp({
      profileDir,
      settings: { firstUseCompleted: true, hardwareAcceleration: true }
    })
    try {
      accelerated = await measureApp(acceleratedCtx.app)
      test.skip(
        median(accelerated.samples) <= 16 * MIB,
        'Electron did not establish a dedicated-GPU-memory baseline'
      )
      await disableHardwareAccelerationFromDesktopSettings(acceleratedCtx)
    } finally {
      await acceleratedCtx.cleanup()
    }

    const disabledCtx = await launchApp({ profileDir })
    try {
      disabled = await measureApp(disabledCtx.app)
    } finally {
      await disabledCtx.cleanup()
    }
  } finally {
    await rm(profileDir, { recursive: true, force: true })
  }

  const acceleratedBytes = median(accelerated.samples)
  const disabledBytes = median(disabled.samples)

  console.log(
    `[hardware-acceleration] enabled=${(acceleratedBytes / MIB).toFixed(1)} MiB ` +
      `disabled=${(disabledBytes / MIB).toFixed(1)} MiB ` +
      `enabledSamples=${accelerated.samples.map((value) => (value / MIB).toFixed(1)).join(',')} ` +
      `disabledSamples=${disabled.samples.map((value) => (value / MIB).toFixed(1)).join(',')}`
  )

  expect(disabled.gpuCompositing).not.toBe('enabled')
  expect(
    disabledBytes,
    'The disabled launch should use at least 16 MiB less dedicated GPU memory'
  ).toBeLessThan(acceleratedBytes - 16 * MIB)
})
