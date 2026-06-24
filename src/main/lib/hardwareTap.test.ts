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
  parseModelType,
  parseWeightDtype
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

describe('parseVramLine / parseModelType / parseWeightDtype', () => {
  it('parses VRAM/RAM amounts', () => {
    expect(parseVramLine('Total VRAM 24576 MB, total RAM 65461 MB')).toEqual({
      vramMb: 24576,
      ramMb: 65461
    })
    expect(parseVramLine('nope')).toBeNull()
  })

  it('parses model_type architecture name', () => {
    expect(parseModelType('model_type FLUX')).toBe('FLUX')
    expect(parseModelType('model_type EPS')).toBe('EPS')
    expect(parseModelType('model_type V_PREDICTION')).toBe('V_PREDICTION')
    expect(parseModelType('something else')).toBeNull()
  })

  it('rejects non-enum model_type tokens (paths, filenames, lowercase)', () => {
    expect(parseModelType('model_type C:\\Users\\me\\secret.safetensors')).toBeNull()
    expect(parseModelType('model_type my-private-model.safetensors')).toBeNull()
    expect(parseModelType('model_type flux')).toBeNull()
    expect(parseModelType('model_type FLUX extra trailing words')).toBeNull()
  })

  it('parses weight dtype', () => {
    expect(parseWeightDtype('model weight dtype torch.float16, manual cast: None')).toBe(
      'torch.float16'
    )
    expect(parseWeightDtype('model weight dtype torch.bfloat16, manual cast: torch.float32')).toBe(
      'torch.bfloat16'
    )
    expect(parseWeightDtype('no dtype here')).toBeNull()
  })
})

describe('createHardwareTap', () => {
  let captured: Array<{ event: string; ctx: Record<string, unknown> }>
  let personProps: Array<Record<string, unknown>>
  let personPropsOnce: Array<Record<string, unknown>>

  beforeEach(() => {
    captured = []
    personProps = []
    personPropsOnce = []
    vi.spyOn(telemetry, 'emit').mockImplementation((event, ctx) => {
      captured.push({ event, ctx: ctx as Record<string, unknown> })
    })
    vi.spyOn(telemetry, 'registerPersonProperties').mockImplementation((p) => {
      personProps.push(p as Record<string, unknown>)
    })
    vi.spyOn(telemetry, 'registerPersonPropertiesOnce').mockImplementation((p) => {
      personPropsOnce.push(p as Record<string, unknown>)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits accelerator_detected once on the first Device line, merging earlier lines', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Set cuda device to: 0\n', 'stdout')
    tap.ingest('Total VRAM 24576 MB, total RAM 65461 MB\n', 'stdout')
    tap.ingest('pytorch version: 2.10.0+cu130\n', 'stdout')
    tap.ingest('xformers version: 0.0.31\n', 'stdout')
    tap.ingest('Device: cuda:0 NVIDIA GeForce RTX 4090 : native\n', 'stdout')
    // A second Device line (other GPU) must NOT re-emit.
    tap.ingest('Device: cuda:1 NVIDIA GeForce RTX 4090 : native\n', 'stdout')

    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(1)
    expect(accel[0]!.ctx).toMatchObject({
      installation_id: 'inst-1',
      device_type: 'cuda',
      device_index: 0,
      gpu_model: 'NVIDIA GeForce RTX 4090',
      backend: 'native',
      vram_mb: 24576,
      vram_gb: 24,
      ram_mb: 65461,
      pytorch_version: '2.10.0+cu130',
      xformers_version: '0.0.31',
      cuda_device_set: 0
    })
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
    tap.ingest('\u001b[32m[INFO]\u001b[0m model weight dtype torch.bfloat16, manual cast: None\n', 'stdout')
    tap.ingest('\u001b[32m[INFO]\u001b[0m model_type FLOW\n', 'stdout')

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
      model_type: 'FLOW',
      count: 1,
      dtype: 'torch.bfloat16'
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
    expect(personProps).toContainEqual({
      comfyui_gpu_model: 'NVIDIA GeForce RTX 4090',
      comfyui_gpu_vram_gb: 24,
      comfyui_device_type: 'cuda'
    })
  })

  it('does not promote a cpu device to gpu person properties', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Device: cpu\n', 'stdout')
    expect(personProps).toHaveLength(0)
    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(1)
    expect(accel[0]!.ctx).toMatchObject({ device_type: 'cpu', gpu_model: null })
  })

  it('aggregates model loads into per-arch deltas flushed on session end', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('model weight dtype torch.float16, manual cast: None\nmodel_type FLUX\n', 'stdout')
    tap.ingest('model_type FLUX\n', 'stdout')
    tap.ingest('model weight dtype torch.float16, manual cast: None\nmodel_type EPS\n', 'stdout')
    // Nothing emitted until flush.
    expect(captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')).toHaveLength(0)

    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toHaveLength(2)
    expect(usage.find((u) => u.ctx['model_type'] === 'FLUX')!.ctx).toMatchObject({
      count: 2,
      dtype: 'torch.float16'
    })
    expect(usage.find((u) => u.ctx['model_type'] === 'EPS')!.ctx).toMatchObject({ count: 1 })
  })

  it('flushes deltas: a second flush only reports loads since the first', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('model_type FLUX\n', 'stdout')
    tap.flushSummary()
    tap.ingest('model_type FLUX\nmodel_type FLUX\n', 'stdout')
    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage.map((u) => u.ctx['count'])).toEqual([1, 2])
  })

  it('writes a per-person $set_once marker the first time each arch is seen', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('model_type FLUX\nmodel_type FLUX\nmodel_type EPS\n', 'stdout')
    // One marker per distinct arch, not per load.
    expect(personPropsOnce).toHaveLength(2)
    expect(Object.keys(personPropsOnce[0]!)[0]).toBe('used_model_flux_at')
    expect(Object.keys(personPropsOnce[1]!)[0]).toBe('used_model_eps_at')
  })

  it('re-emits accelerator_detected after beginBoot (ComfyUI restart in one launch)', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Total VRAM 24576 MB, total RAM 65461 MB\n', 'stdout')
    tap.ingest('Device: cuda:0 NVIDIA GeForce RTX 4090 : native\n', 'stdout')
    expect(
      captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    ).toHaveLength(1)

    // Simulate a restart: a stale Device line is ignored until beginBoot resets.
    tap.ingest('Device: cuda:0 NVIDIA GeForce RTX 4090 : native\n', 'stdout')
    expect(
      captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    ).toHaveLength(1)

    tap.beginBoot()
    tap.ingest('Total VRAM 16384 MB, total RAM 32768 MB\n', 'stdout')
    tap.ingest('Device: cuda:0 NVIDIA GeForce RTX 4080 : native\n', 'stdout')
    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(2)
    expect(accel[1]!.ctx).toMatchObject({ gpu_model: 'NVIDIA GeForce RTX 4080', vram_mb: 16384 })
  })

  it('preserves model-usage counts across beginBoot (aggregate per launch)', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('model_type FLUX\n', 'stdout')
    tap.beginBoot()
    tap.ingest('model_type FLUX\n', 'stdout')
    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toHaveLength(1)
    expect(usage[0]!.ctx).toMatchObject({ model_type: 'FLUX', count: 2 })
  })

  it('flushes a trailing unterminated model_type line on session end', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('model_type FLUX', 'stdout') // no newline
    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toHaveLength(1)
    expect(usage[0]!.ctx).toMatchObject({ model_type: 'FLUX', count: 1 })
  })

  it('handles lines split across chunk boundaries', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('Device: cuda:0 NVIDIA GeForce ', 'stdout')
    tap.ingest('RTX 4090 : native\n', 'stdout')
    const accel = captured.filter((c) => c.event === 'comfy.desktop.comfyui.accelerator_detected')
    expect(accel).toHaveLength(1)
    expect(accel[0]!.ctx).toMatchObject({ gpu_model: 'NVIDIA GeForce RTX 4090' })
  })

  it('keeps stdout and stderr partial lines from splicing together', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    // Interleaved partial lines from two streams must not be concatenated into
    // a bogus combined line; each stream's buffer completes independently.
    tap.ingest('model_type ', 'stdout')
    tap.ingest('some unrelated stderr noise\n', 'stderr')
    tap.ingest('FLUX\n', 'stdout')
    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toHaveLength(1)
    expect(usage[0]!.ctx).toMatchObject({ model_type: 'FLUX', count: 1 })
  })

  it('flushes trailing unterminated lines from both stdout and stderr', () => {
    const tap = createHardwareTap({ installationId: 'inst-1' })
    tap.ingest('model_type FLUX', 'stdout') // no newline
    tap.ingest('model_type EPS', 'stderr') // no newline
    tap.flushSummary()
    const usage = captured.filter((c) => c.event === 'comfy.desktop.comfyui.model_usage')
    expect(usage).toContainEqual(
      expect.objectContaining({ ctx: expect.objectContaining({ model_type: 'FLUX', count: 1 }) })
    )
    expect(usage).toContainEqual(
      expect.objectContaining({ ctx: expect.objectContaining({ model_type: 'EPS', count: 1 }) })
    )
  })
})
