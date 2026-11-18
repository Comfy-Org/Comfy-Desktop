import * as telemetry from './telemetry'
import type { SessionKind } from '../../shared/performanceTestSession'
import { createModelUsageSummary } from './modelUsageSummary'
import { createStreamLineBuffer, stripAnsi, stripLogLevelPrefix } from './stderrTail'
import type { AcceleratorInfo, AcceleratorSnapshot } from '../../types/ipc'

export type { AcceleratorInfo, AcceleratorSnapshot } from '../../types/ipc'

const DEVICE_LINE = /^Device:\s*(.+)$/
const VRAM_LINE = /^Total VRAM\s+(\d+)\s*MB,\s*total RAM\s+(\d+)\s*MB/i
const PYTORCH_LINE = /^pytorch version:\s*(.+)$/i
const XFORMERS_LINE = /^xformers version:\s*(.+)$/i
const CUDA_DEVICE_LINE = /^Set cuda device to:\s*(\d+)/i
const DIRECTML_LINE = /^Using directml with device:\s*(.+)$/i
const ASSET_SCAN_ERROR_LINE =
  /^Asset scan error: phase=(reference_stat|discovery_stat|enrichment_stat|hashing) error_type=(permission_denied|os_error)$/

const MODEL_USAGE_FLUSH_INTERVAL_MS = 60 * 60_000

export function parseDeviceLine(line: string): AcceleratorInfo | null {
  const m = line.match(DEVICE_LINE)
  if (!m || !m[1]) return null
  let rest = m[1].trim()
  if (/^CUDA\s+/i.test(rest)) rest = rest.replace(/^CUDA\s+/i, '')
  const tok = rest.match(/^([A-Za-z][A-Za-z0-9]*)(?::(\d+))?/)
  if (!tok || !tok[1]) return null
  const deviceType = tok[1].toLowerCase()
  const deviceIndex = tok[2] != null ? Number(tok[2]) : null
  const remainder = rest.slice(tok[0].length).trim().replace(/^:\s*/, '')
  let deviceName: string | null = remainder || null
  let backend: string | null = null
  const sep = remainder.lastIndexOf(' : ')
  if (sep >= 0) {
    deviceName = remainder.slice(0, sep).trim() || null
    backend = remainder.slice(sep + 3).trim() || null
  }
  return { deviceType, deviceIndex, deviceName, backend }
}

export function parseVramLine(line: string): { vramMb: number; ramMb: number } | null {
  const m = line.match(VRAM_LINE)
  if (!m || !m[1] || !m[2]) return null
  return { vramMb: Number(m[1]), ramMb: Number(m[2]) }
}

function parseTail(line: string, re: RegExp): string | null {
  const m = line.match(re)
  return m && m[1] ? m[1].trim() : null
}

const MAX_DEVICES = 16

export function createHardwareTap(opts: {
  installationId: string
  variant?: string | null
  release?: string | null
  coreBetaFlags?: readonly string[]
  coreCommit?: string | null
  coreVersionLabel?: string | null
  sessionKind?: SessionKind
}): {
  ingest: (chunk: string, source: 'stdout' | 'stderr') => void
  beginBoot: () => void
  getAcceleratorInfo: () => AcceleratorSnapshot | null
  flushSummary: () => void
} {
  const baseContext = {
    installation_id: opts.installationId,
    variant: opts.variant ?? null,
    release: opts.release ?? null,
    core_beta_flags: [...(opts.coreBetaFlags ?? [])],
    core_commit: opts.coreCommit ?? null,
    core_version_label: opts.coreVersionLabel ?? null,
    session_kind: opts.sessionKind ?? 'normal'
  }

  let acceleratorEmitted = false
  let vramMb: number | null = null
  let ramMb: number | null = null
  let pytorchVersion: string | null = null
  let xformersVersion: string | null = null
  let cudaDeviceSet: number | null = null
  let directmlDeviceName: string | null = null
  const devices: AcceleratorInfo[] = []
  const emittedAssetScanErrors = new Set<string>()
  const modelUsage = createModelUsageSummary()
  let modelUsageFlushTimer: ReturnType<typeof setInterval> | null = null

  function emitModelUsage(): void {
    const properties = modelUsage.drainProperties()
    if (!properties) return
    telemetry.emit('comfy.desktop.comfyui.model_usage_summary', {
      ...baseContext,
      model_summary_interval_seconds: MODEL_USAGE_FLUSH_INTERVAL_MS / 1000,
      ...properties
    })
  }

  function ensureModelUsageFlushTimer(): void {
    if (modelUsageFlushTimer) return
    modelUsageFlushTimer = setInterval(emitModelUsage, MODEL_USAGE_FLUSH_INTERVAL_MS)
    modelUsageFlushTimer.unref?.()
  }

  function emitAccelerator(): void {
    if (acceleratorEmitted || devices.length === 0) return
    acceleratorEmitted = true
    const primary = devices[0]!
    const vramGb = vramMb != null ? Math.round(vramMb / 1024) : null
    const primaryName =
      primary.deviceName ??
      (primary.deviceType !== 'cpu' && primary.deviceType !== 'mps' ? directmlDeviceName : null)
    const gpuModels = devices.map((d, i) => (i === 0 ? primaryName : d.deviceName))
    telemetry.emit('comfy.desktop.comfyui.accelerator_detected', {
      ...baseContext,
      device_type: primary.deviceType,
      device_index: primary.deviceIndex,
      gpu_model: primaryName,
      backend: primary.backend,
      device_count: devices.length,
      device_types: devices.map((d) => d.deviceType),
      device_indices: devices.map((d) => d.deviceIndex),
      gpu_models: gpuModels,
      device_backends: devices.map((d) => d.backend),
      vram_mb: vramMb,
      vram_gb: vramGb,
      ram_mb: ramMb,
      pytorch_version: pytorchVersion,
      xformers_version: xformersVersion,
      cuda_device_set: cudaDeviceSet
    })
    if (primaryName && primary.deviceType !== 'cpu') {
      telemetry.registerPersonProperties({
        comfyui_gpu_model: primaryName,
        comfyui_gpu_vram_gb: vramGb,
        comfyui_device_type: primary.deviceType,
        comfyui_gpu_count: devices.length
      })
    }
  }

  function getAcceleratorInfo(): AcceleratorSnapshot | null {
    if (devices.length === 0) return null
    const primary = devices[0]!
    const primaryName =
      primary.deviceName ??
      (primary.deviceType !== 'cpu' && primary.deviceType !== 'mps' ? directmlDeviceName : null)
    return {
      ...primary,
      deviceName: primaryName,
      devices: devices.map((device, index) => ({
        ...device,
        deviceName: index === 0 ? primaryName : device.deviceName
      })),
      vramMb,
      ramMb,
      pytorchVersion,
      xformersVersion,
      cudaDeviceSet
    }
  }

  function handleLine(line: string): void {
    const trimmed = stripLogLevelPrefix(stripAnsi(line).trim())
    if (trimmed.length === 0) return

    const scanError = trimmed.match(ASSET_SCAN_ERROR_LINE)
    if (scanError) {
      const scanPhase = scanError[1]!
      const errorType = scanError[2]!
      const key = `${scanPhase}:${errorType}`
      if (!emittedAssetScanErrors.has(key)) {
        emittedAssetScanErrors.add(key)
        telemetry.emit('comfy.desktop.comfyui.asset_scan_error', {
          ...baseContext,
          scan_phase: scanPhase,
          error_type: errorType
        })
      }
      return
    }

    if (!acceleratorEmitted) {
      const vram = parseVramLine(trimmed)
      if (vram) {
        vramMb = vram.vramMb
        ramMb = vram.ramMb
        return
      }
      const pytorch = parseTail(trimmed, PYTORCH_LINE)
      if (pytorch) {
        pytorchVersion = pytorch
        return
      }
      const xformers = parseTail(trimmed, XFORMERS_LINE)
      if (xformers) {
        xformersVersion = xformers
        return
      }
      const cudaDevice = parseTail(trimmed, CUDA_DEVICE_LINE)
      if (cudaDevice) {
        cudaDeviceSet = Number(cudaDevice)
        return
      }
      const directml = parseTail(trimmed, DIRECTML_LINE)
      if (directml) {
        directmlDeviceName = directml
        return
      }
      const device = parseDeviceLine(trimmed)
      if (device) {
        if (devices.length < MAX_DEVICES) devices.push(device)
        return
      }
      if (devices.length > 0) emitAccelerator()
    }

    if (modelUsage.recordLine(trimmed)) ensureModelUsageFlushTimer()
  }

  const lineBuffer = createStreamLineBuffer()

  return {
    ingest(chunk: string, source: 'stdout' | 'stderr'): void {
      for (const line of lineBuffer.append(source, chunk)) {
        try {
          handleLine(line)
        } catch {}
      }
    },
    beginBoot(): void {
      acceleratorEmitted = false
      vramMb = null
      ramMb = null
      pytorchVersion = null
      xformersVersion = null
      cudaDeviceSet = null
      directmlDeviceName = null
      devices.length = 0
      emittedAssetScanErrors.clear()
      lineBuffer.reset()
    },
    getAcceleratorInfo,
    flushSummary(): void {
      for (const source of ['stdout', 'stderr'] as const) {
        try {
          const pending = lineBuffer.takePending(source)
          if (pending.trim()) handleLine(pending)
        } catch {}
      }
      if (modelUsageFlushTimer) {
        clearInterval(modelUsageFlushTimer)
        modelUsageFlushTimer = null
      }
      try {
        emitAccelerator()
      } catch {}
      try {
        emitModelUsage()
      } catch {}
    }
  }
}
