import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'launcher-test'),
    isPackaged: false,
    on: () => {}
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { createHardwareTap, parseDeviceLine, parseVramLine } = await import('./hardwareTap')
const telemetry = await import('./telemetry')

describe('parseDeviceLine', () => {
  it('parses the cuda format with backend suffix', () => {
    expect(parseDeviceLine('Device: cuda:0 NVIDIA GeForce RTX 4090 : native')).toEqual({
      deviceType: 'cuda',
      deviceIndex: 0,
      deviceName: 'NVIDIA GeForce RTX 4090',
      backend: 'native'
    })
  })

  it('parses the cudaMallocAsync backend', () => {
    expect(parseDeviceLine('Device: cuda:1 NVIDIA RTX A6000 : cudaMallocAsync')).toMatchObject({
      deviceIndex: 1,
      deviceName: 'NVIDIA RTX A6000',
      backend: 'cudaMallocAsync'
    })
  })

  it('parses the legacy "CUDA cuda:0: name" fallback format', () => {
    expect(parseDeviceLine('Device: CUDA cuda:0: NVIDIA GeForce GTX 1080')).toEqual({
      deviceType: 'cuda',
      deviceIndex: 0,
      deviceName: 'NVIDIA GeForce GTX 1080',
      backend: null
    })
  })

  it('parses the xpu format without a backend suffix', () => {
    expect(parseDeviceLine('Device: xpu:0 Intel(R) Arc(TM) A770 Graphics')).toEqual({
      deviceType: 'xpu',
      deviceIndex: 0,
      deviceName: 'Intel(R) Arc(TM) A770 Graphics',
      backend: null
    })
  })

  it('parses bare device types (cpu / mps)', () => {
    expect(parseDeviceLine('Device: cpu')).toEqual({
      deviceType: 'cpu',
      deviceIndex: null,
      deviceName: null,
      backend: null
    })
    expect(parseDeviceLine('Device: mps')).toMatchObject({ deviceType: 'mps', deviceName: null })
  })

  it('returns null for non-device lines', () => {
    expect(parseDeviceLine('Total VRAM 24576 MB, total RAM 65461 MB')).toBeNull()
    expect(parseDeviceLine('')).toBeNull()
  })
})

describe('parseVramLine', () => {
  it('parses VRAM/RAM amounts', () => {
    expect(parseVramLine('Total VRAM 24576 MB, total RAM 65461 MB')).toEqual({
      vramMb: 24576,
      ramMb: 65461
    })
    expect(parseVramLine('nope')).toBeNull()
  })
})

describe('createHardwareTap', () => {
  let captured: Array<{ event: string; ctx: Record<string, unknown> }>
  let personProps: Array<Record<string, unknown>>

  beforeEach(() => {
    captured = []
    personProps = []
    vi.spyOn(telemetry, 'emit').mockImplementation((event, ctx) => {
      captured.push({ event, ctx: ctx as Record<string, unknown> })
    })
    vi.spyOn(telemetry, 'registerPersonProperties').mockImplementation((p) => {
      personProps.push(p as Record<string, unknown>)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits a single accelerator_detected for the whole Device run, merging earlier lines', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Set cuda device to: 0\n', 'stdout')
    tap.ingest('Total VRAM 24576 MB, total RAM 65461 MB\n', 'stdout')
    tap.ingest('pytorch version: 2.10.0+cu130\n', 'stdout')
    tap.ingest('xformers version: 0.0.31\n', 'stdout')
    tap.ingest('Device: cuda:0 NVIDIA GeForce RTX 4090 : native\n', 'stdout')
    // A second Device line (other GPU) is part of the SAME event, not a new one.
    tap.ingest('Device: cuda:1 NVIDIA GeForce RTX 5090 : native\n', 'stdout')
    // A non-Device line closes the run and triggers the single emit.
    tap.ingest('Using xformers attention\n', 'stdout')

    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(1)
    expect(accel[0]!.ctx).toMatchObject({
      installation_id: 'inst-1',
      device_type: 'cuda',
      device_index: 0,
      gpu_model: 'NVIDIA GeForce RTX 4090',
      backend: 'native',
      device_count: 2,
      vram_mb: 24576,
      vram_gb: 24,
      ram_mb: 65461,
      pytorch_version: '2.10.0+cu130',
      xformers_version: '0.0.31',
      cuda_device_set: 0
    })
    // All devices reported as parallel arrays aligned by index.
    expect(accel[0]!.ctx['device_types']).toEqual(['cuda', 'cuda'])
    expect(accel[0]!.ctx['device_indices']).toEqual([0, 1])
    expect(accel[0]!.ctx['gpu_models']).toEqual([
      'NVIDIA GeForce RTX 4090',
      'NVIDIA GeForce RTX 5090'
    ])
    expect(accel[0]!.ctx['device_backends']).toEqual(['native', 'native'])
  })

  it('parses current ComfyUI log lines carrying a colored [LEVEL] prefix', () => {
    // ComfyUI's ColoredFormatter emits `\x1b[32m[INFO]\x1b[0m <message>`, not
    // the bare `%(message)s` the parsers are anchored against. The tap must
    // strip ANSI then the level tag for the accelerator event to fire.
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('\u001b[32m[INFO]\u001b[0m Total VRAM 32607 MB, total RAM 97430 MB\n', 'stdout')
    tap.ingest('\u001b[32m[INFO]\u001b[0m pytorch version: 2.10.0+cu130\n', 'stdout')
    tap.ingest(
      '\u001b[32m[INFO]\u001b[0m Device: cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync\n',
      'stdout'
    )
    tap.ingest('\u001b[32m[INFO]\u001b[0m Using xformers attention\n', 'stdout')

    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(1)
    expect(accel[0]!.ctx).toMatchObject({
      device_type: 'cuda',
      device_index: 0,
      gpu_model: 'NVIDIA GeForce RTX 5090',
      backend: 'cudaMallocAsync',
      vram_mb: 32607,
      pytorch_version: '2.10.0+cu130'
    })
  })

  it('detects a complete Device line even in an oversized chunk', () => {
    // A single large stdout chunk: complete metadata + Device lines, then a
    // huge unterminated tail. The buffer cap must only trim the tail, never
    // drop the complete lines that precede it.
    const tap = createHardwareTap({ installationId: 'inst-1' })
    const hugeTail = 'x'.repeat(64 * 1024) // > MAX_PENDING_CHARS, no newline
    tap.ingest(
      'Total VRAM 24576 MB, total RAM 65461 MB\n' +
        'Device: cuda:0 NVIDIA GeForce RTX 4090 : native\n' +
        'startup continues\n' +
        hugeTail,
      'stdout'
    )

    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(1)
    expect(accel[0]!.ctx).toMatchObject({ gpu_model: 'NVIDIA GeForce RTX 4090', vram_mb: 24576 })
  })

  it('promotes the compute GPU to comfyui_* person properties', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Total VRAM 24576 MB, total RAM 65461 MB\n', 'stdout')
    tap.ingest('Device: cuda:0 NVIDIA GeForce RTX 4090 : native\n', 'stdout')
    tap.flushSummary()
    expect(personProps).toContainEqual({
      comfyui_gpu_model: 'NVIDIA GeForce RTX 4090',
      comfyui_gpu_vram_gb: 24,
      comfyui_device_type: 'cuda',
      comfyui_gpu_count: 1
    })
  })

  it('does not promote a cpu device to gpu person properties', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Device: cpu\n', 'stdout')
    tap.flushSummary()
    expect(personProps).toHaveLength(0)
    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(1)
    expect(accel[0]!.ctx).toMatchObject({ device_type: 'cpu', gpu_model: null })
  })

  it('recovers the DirectML GPU name from the separate "Using directml" line', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Using directml with device: AMD Radeon RX 6800\n', 'stdout')
    tap.ingest('Total VRAM 16384 MB, total RAM 32768 MB\n', 'stdout')
    tap.ingest('Device: privateuseone\n', 'stdout')
    tap.flushSummary()
    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(1)
    expect(accel[0]!.ctx).toMatchObject({
      device_type: 'privateuseone',
      gpu_model: 'AMD Radeon RX 6800'
    })
    expect(personProps).toContainEqual({
      comfyui_gpu_model: 'AMD Radeon RX 6800',
      comfyui_gpu_vram_gb: 16,
      comfyui_device_type: 'privateuseone',
      comfyui_gpu_count: 1
    })
  })

  it('emits non-cuda accelerators (Intel xpu) without requiring a cuda device', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Total VRAM 16384 MB, total RAM 32768 MB\n', 'stdout')
    tap.ingest('Device: xpu:0 Intel(R) Arc(TM) A770 Graphics\n', 'stdout')
    tap.flushSummary()
    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(1)
    expect(accel[0]!.ctx).toMatchObject({
      device_type: 'xpu',
      device_index: 0,
      gpu_model: 'Intel(R) Arc(TM) A770 Graphics',
      device_count: 1
    })
    expect(personProps).toContainEqual({
      comfyui_gpu_model: 'Intel(R) Arc(TM) A770 Graphics',
      comfyui_gpu_vram_gb: 16,
      comfyui_device_type: 'xpu',
      comfyui_gpu_count: 1
    })
  })

  it('re-emits accelerator_detected after beginBoot (ComfyUI restart in one launch)', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Total VRAM 24576 MB, total RAM 65461 MB\n', 'stdout')
    tap.ingest('Device: cuda:0 NVIDIA GeForce RTX 4090 : native\n', 'stdout')
    tap.ingest('startup continues\n', 'stdout') // closes the run -> emit
    expect(
      captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    ).toHaveLength(1)

    // A stale Device line after the run already emitted must NOT re-emit.
    tap.ingest('Device: cuda:0 NVIDIA GeForce RTX 4090 : native\n', 'stdout')
    tap.ingest('more logs\n', 'stdout')
    expect(
      captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    ).toHaveLength(1)

    tap.beginBoot()
    tap.ingest('Total VRAM 16384 MB, total RAM 32768 MB\n', 'stdout')
    tap.ingest('Device: cuda:0 NVIDIA GeForce RTX 4080 : native\n', 'stdout')
    tap.flushSummary() // closes the second boot's run
    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(2)
    expect(accel[1]!.ctx).toMatchObject({ gpu_model: 'NVIDIA GeForce RTX 4080', vram_mb: 16384 })
  })

  it('handles lines split across chunk boundaries', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Device: cuda:0 NVIDIA GeForce ', 'stdout')
    tap.ingest('RTX 4090 : native\n', 'stdout')
    tap.flushSummary() // closes the run -> emit
    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(1)
    expect(accel[0]!.ctx).toMatchObject({ gpu_model: 'NVIDIA GeForce RTX 4090' })
  })

  it('keeps stdout and stderr partial lines from splicing together', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    // Interleaved partial lines from two streams must not be concatenated into
    // a bogus combined line; each stream's buffer completes independently.
    tap.ingest('Device: cuda:0 NVIDIA GeForce ', 'stdout')
    tap.ingest('some unrelated stderr noise\n', 'stderr')
    tap.ingest('RTX 4090 : native\n', 'stdout')
    tap.flushSummary()
    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(1)
    expect(accel[0]!.ctx).toMatchObject({ gpu_model: 'NVIDIA GeForce RTX 4090' })
  })

  it('flushes a trailing unterminated Device line on session end', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Total VRAM 24576 MB, total RAM 65461 MB\n', 'stdout')
    tap.ingest('Device: cuda:0 NVIDIA GeForce RTX 4090 : native', 'stdout') // no newline
    tap.flushSummary()
    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(1)
    expect(accel[0]!.ctx).toMatchObject({ gpu_model: 'NVIDIA GeForce RTX 4090', vram_mb: 24576 })
  })
})
