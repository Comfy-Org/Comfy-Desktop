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

const {
  createHardwareTap,
  parseDeviceLine,
  parseVramLine,
  parseRequestedModelLoad,
  parseDynamicVramPrepare,
  parseModelDeepclone,
  parseModelLoad
} = await import('./hardwareTap')
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

describe('parseVramLine / parseRequestedModelLoad', () => {
  it('parses VRAM/RAM amounts', () => {
    expect(parseVramLine('Total VRAM 24576 MB, total RAM 65461 MB')).toEqual({
      vramMb: 24576,
      ramMb: 65461
    })
    expect(parseVramLine('nope')).toBeNull()
  })

  it('parses the loaded model class name', () => {
    expect(parseRequestedModelLoad('Requested to load Lumina2')).toBe('Lumina2')
    expect(parseRequestedModelLoad('Requested to load ZImageTEModel_')).toBe('ZImageTEModel_')
    expect(parseRequestedModelLoad('Requested to load AutoencodingEngine')).toBe(
      'AutoencodingEngine'
    )
    expect(parseRequestedModelLoad('something else')).toBeNull()
  })

  it('rejects non-identifier load tokens (paths, filenames, trailing words)', () => {
    expect(parseRequestedModelLoad('Requested to load C:\\Users\\me\\secret.safetensors')).toBeNull()
    expect(parseRequestedModelLoad('Requested to load my-private-model.safetensors')).toBeNull()
    expect(parseRequestedModelLoad('Requested to load Lumina2 and free memory')).toBeNull()
  })

  it('parses the dynamic-VRAM prepare class name', () => {
    expect(
      parseDynamicVramPrepare(
        'Model Lumina2 prepared for dynamic VRAM loading. 11738MB Staged. 0 patches attached.'
      )
    ).toBe('Lumina2')
    expect(
      parseDynamicVramPrepare('Model ZImageTEModel_ prepared for dynamic VRAM loading. 7671MB Staged.')
    ).toBe('ZImageTEModel_')
    expect(parseDynamicVramPrepare('Requested to load Lumina2')).toBeNull()
    expect(parseDynamicVramPrepare('Model prepared for something else')).toBeNull()
  })

  it('parses a multi-GPU deepclone line into class + target device', () => {
    expect(parseModelDeepclone('Creating deepclone of Lumina2 for cuda:1.')).toEqual({
      modelClass: 'Lumina2',
      targetDevice: 'cuda:1'
    })
    expect(
      parseModelDeepclone('Reusing loaded multigpu deepclone of Lumina2 for cuda:1')
    ).toEqual({ modelClass: 'Lumina2', targetDevice: 'cuda:1' })
    expect(parseModelDeepclone('Creating deepclone of ZImageTEModel_ for xpu:2')).toEqual({
      modelClass: 'ZImageTEModel_',
      targetDevice: 'xpu:2'
    })
    expect(parseModelDeepclone('Requested to load Lumina2')).toBeNull()
    expect(parseModelDeepclone('Creating deepclone of some file.safetensors for cuda:1')).toBeNull()
  })

  it('classifies a model-load line by trigger', () => {
    expect(parseModelLoad('Requested to load Lumina2')).toEqual({
      modelClass: 'Lumina2',
      trigger: 'requested'
    })
    expect(
      parseModelLoad('Model AutoencodingEngine prepared for dynamic VRAM loading. 159MB Staged.')
    ).toEqual({ modelClass: 'AutoencodingEngine', trigger: 'dynamic_prepare' })
    expect(parseModelLoad('Creating deepclone of Lumina2 for cuda:1.')).toEqual({
      modelClass: 'Lumina2',
      trigger: 'deepclone',
      targetDevice: 'cuda:1'
    })
    expect(parseModelLoad('unrelated noise')).toBeNull()
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
    // strip ANSI then the level tag for accelerator + model-usage to fire.
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('\u001b[32m[INFO]\u001b[0m Total VRAM 32607 MB, total RAM 97430 MB\n', 'stdout')
    tap.ingest('\u001b[32m[INFO]\u001b[0m pytorch version: 2.10.0+cu130\n', 'stdout')
    tap.ingest(
      '\u001b[32m[INFO]\u001b[0m Device: cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync\n',
      'stdout'
    )
    tap.ingest('\u001b[32m[INFO]\u001b[0m Requested to load Lumina2\n', 'stdout')

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

    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toHaveLength(1)
    expect(usage[0]!.ctx).toMatchObject({
      model_class: 'Lumina2',
      count: 1
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

  it('aggregates model loads into per-class deltas flushed on session end', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Requested to load Lumina2\n', 'stdout')
    tap.ingest('Requested to load Lumina2\n', 'stdout')
    tap.ingest('Requested to load AutoencodingEngine\n', 'stdout')
    // Nothing emitted until flush.
    expect(captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')).toHaveLength(0)

    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toHaveLength(2)
    expect(usage.find((u) => u.ctx['model_class'] === 'Lumina2')!.ctx).toMatchObject({
      count: 2
    })
    expect(usage.find((u) => u.ctx['model_class'] === 'AutoencodingEngine')!.ctx).toMatchObject({
      count: 1
    })
  })

  it('flushes deltas: a second flush only reports loads since the first', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Requested to load Lumina2\n', 'stdout')
    tap.flushSummary()
    tap.ingest('Requested to load Lumina2\nRequested to load Lumina2\n', 'stdout')
    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage.map((u) => u.ctx['count'])).toEqual([1, 2])
  })

  it('tags each model_usage event with its load_trigger', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Requested to load Lumina2\n', 'stdout')
    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toHaveLength(1)
    expect(usage[0]!.ctx).toMatchObject({
      model_class: 'Lumina2',
      load_trigger: 'requested',
      count: 1,
      target_device: null
    })
  })

  it('emits multi-GPU deepclones with their target device, counted per device', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    // Desktop's bundled build prefixes lines with a level tag.
    tap.ingest('[INFO] Creating deepclone of Lumina2 for cuda:1.\n', 'stdout')
    tap.ingest('[INFO] Reusing loaded multigpu deepclone of Lumina2 for cuda:1\n', 'stdout')
    tap.ingest('[INFO] Creating deepclone of Lumina2 for cuda:2.\n', 'stdout')
    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toHaveLength(2)
    expect(
      usage.find((u) => u.ctx['target_device'] === 'cuda:1')!.ctx
    ).toMatchObject({ model_class: 'Lumina2', load_trigger: 'deepclone', count: 2 })
    expect(
      usage.find((u) => u.ctx['target_device'] === 'cuda:2')!.ctx
    ).toMatchObject({ model_class: 'Lumina2', load_trigger: 'deepclone', count: 1 })
  })

  it('counts dynamic-VRAM prepares separately from cold loads of the same class', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Requested to load Lumina2\n', 'stdout')
    tap.ingest(
      'Model Lumina2 prepared for dynamic VRAM loading. 11738MB Staged. 0 patches attached.\n',
      'stdout'
    )
    tap.ingest(
      'Model Lumina2 prepared for dynamic VRAM loading. 11738MB Staged. 0 patches attached.\n',
      'stdout'
    )
    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toHaveLength(2)
    expect(
      usage.find((u) => u.ctx['load_trigger'] === 'requested')!.ctx
    ).toMatchObject({ model_class: 'Lumina2', count: 1 })
    expect(
      usage.find((u) => u.ctx['load_trigger'] === 'dynamic_prepare')!.ctx
    ).toMatchObject({ model_class: 'Lumina2', count: 2 })
  })

  it('caps distinct model classes across the tap lifetime, not per flush', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    // MAX_TRACKED_ARCHITECTURES (60) distinct classes across two flush windows,
    // then one more. The cap must persist across the clear() that flushSummary
    // performs, so the 61st distinct class is rejected.
    for (let i = 0; i < 30; i++) tap.ingest(`Requested to load Model${i}\n`, 'stdout')
    tap.flushSummary()
    for (let i = 30; i < 60; i++) tap.ingest(`Requested to load Model${i}\n`, 'stdout')
    tap.ingest('Requested to load OverflowModel\n', 'stdout')
    tap.flushSummary()

    const classes = captured
      .filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
      .map((c) => c.ctx['model_class'])
    expect(classes).toHaveLength(60)
    expect(classes).not.toContain('OverflowModel')
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

  it('preserves model-usage counts across beginBoot (aggregate per launch)', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Requested to load Lumina2\n', 'stdout')
    tap.beginBoot()
    tap.ingest('Requested to load Lumina2\n', 'stdout')
    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toHaveLength(1)
    expect(usage[0]!.ctx).toMatchObject({ model_class: 'Lumina2', count: 2 })
  })

  it('flushes a trailing unterminated load line on session end', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Requested to load Lumina2', 'stdout') // no newline
    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toHaveLength(1)
    expect(usage[0]!.ctx).toMatchObject({ model_class: 'Lumina2', count: 1 })
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
    tap.ingest('Requested to load ', 'stdout')
    tap.ingest('some unrelated stderr noise\n', 'stderr')
    tap.ingest('Lumina2\n', 'stdout')
    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toHaveLength(1)
    expect(usage[0]!.ctx).toMatchObject({ model_class: 'Lumina2', count: 1 })
  })

  it('flushes trailing unterminated lines from both stdout and stderr', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Requested to load Lumina2', 'stdout') // no newline
    tap.ingest('Requested to load Flux', 'stderr') // no newline
    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toHaveLength(2)
    expect(usage).toContainEqual(
      expect.objectContaining({ ctx: expect.objectContaining({ model_class: 'Lumina2', count: 1 }) })
    )
    expect(usage).toContainEqual(
      expect.objectContaining({ ctx: expect.objectContaining({ model_class: 'Flux', count: 1 }) })
    )
  })
})
