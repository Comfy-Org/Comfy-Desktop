import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DriveInfo } from '../storageInfo'

const capture = vi.fn()
const registerPersonProperties = vi.fn()
vi.mock('../telemetry', () => ({
  capture: (...args: unknown[]) => capture(...args),
  registerPersonProperties: (...args: unknown[]) => registerPersonProperties(...args)
}))

const getInstallation = vi.fn()
vi.mock('../../installations', () => ({
  get: (...args: unknown[]) => getInstallation(...args)
}))

const INSTALL_PATH = 'C:\\Users\\u\\ComfyUI-Installs\\main'
const SHARED_MODELS = 'D:\\ai\\models'
const CACHE_DIR = 'C:\\Users\\u\\cache'
const OUTPUT_DIR = 'C:\\Users\\u\\output'
const APP_DATA = 'C:\\Users\\u\\AppData\\Roaming\\ComfyUI-Launcher'
const BUILTIN_MODELS = `${INSTALL_PATH}\\ComfyUI\\models`

vi.mock('../../settings', () => ({
  get: (key: string) =>
    ({
      modelsDirs: ['D:\\ai\\models'],
      cacheDir: 'C:\\Users\\u\\cache',
      outputDir: 'C:\\Users\\u\\output'
    })[key],
  defaults: {
    modelsDirs: ['D:\\ai\\models'],
    cacheDir: 'C:\\Users\\u\\cache',
    outputDir: 'C:\\Users\\u\\output'
  }
}))

vi.mock('../paths', () => ({
  dataDir: () => 'C:\\Users\\u\\AppData\\Roaming\\ComfyUI-Launcher'
}))

const resolveInstallModelSearchPaths = vi.fn()
vi.mock('../models', () => ({
  resolveInstallModelSearchPaths: (...args: unknown[]) => resolveInstallModelSearchPaths(...args),
  installOutputDir: (installPath: string) => `${installPath}\\ComfyUI\\output`
}))

const classifyPaths = vi.fn()
vi.mock('../storageInfo', () => ({
  classifyPaths: (...args: unknown[]) => classifyPaths(...args)
}))

vi.mock('./shared', () => ({
  sourceMap: {
    standalone: { category: 'local' },
    cloud: { category: 'cloud' }
  }
}))

import { emitStorageTelemetry } from './storageTelemetry'

function drive(overrides: Partial<DriveInfo>): DriveInfo {
  return {
    storageClass: 'unknown',
    bus: 'unknown',
    external: null,
    removable: null,
    fsType: null,
    driveModel: null,
    driveVendor: null,
    driveSizeGb: null,
    volumeSizeGb: null,
    volumeFreeGb: null,
    driveKey: null,
    ...overrides
  }
}

const NVME = drive({
  storageClass: 'nvme_ssd',
  bus: 'nvme',
  external: false,
  fsType: 'NTFS',
  driveModel: 'Samsung SSD 990 PRO 2TB',
  driveVendor: 'Samsung',
  driveSizeGb: 2000,
  volumeSizeGb: 2000,
  volumeFreeGb: 500,
  driveKey: '\\\\.\\PHYSICALDRIVE0'
})

const HDD = drive({
  storageClass: 'hdd',
  bus: 'sata',
  external: false,
  fsType: 'NTFS',
  driveModel: 'WDC WD40EZRZ-00GXCB0',
  driveVendor: 'Western Digital',
  driveSizeGb: 4000,
  volumeSizeGb: 4000,
  volumeFreeGb: 900,
  driveKey: '\\\\.\\PHYSICALDRIVE1'
})

function stubClassification(byPath: Record<string, DriveInfo>): void {
  classifyPaths.mockImplementation((paths: string[]) => {
    const map = new Map<string, DriveInfo>()
    for (const p of paths) map.set(p, byPath[p] ?? drive({}))
    return Promise.resolve(map)
  })
}

const LOCAL_INST = {
  id: 'inst-1',
  sourceId: 'standalone',
  installPath: INSTALL_PATH
}

beforeEach(() => {
  vi.clearAllMocks()
  getInstallation.mockResolvedValue(LOCAL_INST)
  resolveInstallModelSearchPaths.mockReturnValue({
    downloadBaseDir: SHARED_MODELS,
    modelRoots: [BUILTIN_MODELS, SHARED_MODELS],
    extraPaths: []
  })
})

describe('emitStorageTelemetry', () => {
  it('emits classes, same-drive grouping and person properties (split drives)', async () => {
    stubClassification({
      [INSTALL_PATH]: NVME,
      [BUILTIN_MODELS]: NVME,
      [SHARED_MODELS]: HDD,
      [CACHE_DIR]: NVME,
      [OUTPUT_DIR]: NVME,
      [APP_DATA]: NVME
    })

    await emitStorageTelemetry('inst-1')

    expect(capture).toHaveBeenCalledTimes(1)
    const [event, props] = capture.mock.calls[0]!
    expect(event).toBe('comfy.desktop.session.storage_detected')

    expect(props.installation_id).toBe('inst-1')
    expect(props.install_storage_class).toBe('nvme_ssd')
    expect(props.install_bus).toBe('nvme')
    expect(props.install_drive_model).toBe('Samsung SSD 990 PRO 2TB')
    expect(props.install_drive_size_gb).toBe(2000)
    expect(props.install_drive_key).toBe(0)

    expect(props.models_dirs_count).toBe(2)
    expect(props.models_storage_classes).toEqual(['nvme_ssd', 'hdd'])
    expect(props.models_drive_keys).toEqual([0, 1])
    expect(props.models_primary_storage_class).toBe('hdd')
    expect(props.models_primary_drive_key).toBe(1)

    expect(props.distinct_drive_count).toBe(2)
    expect(props.models_primary_same_drive_as_install).toBe(false)
    expect(props.models_all_same_drive_as_install).toBe(false)
    expect(props.any_models_on_hdd).toBe(true)
    expect(props.any_models_external).toBe(false)

    expect(registerPersonProperties).toHaveBeenCalledWith({
      install_drive_class: 'nvme_ssd',
      install_drive_model: 'Samsung SSD 990 PRO 2TB',
      models_primary_drive_class: 'hdd',
      models_separate_from_install: true
    })
  })

  it('reports everything on one drive', async () => {
    stubClassification({
      [INSTALL_PATH]: NVME,
      [BUILTIN_MODELS]: NVME,
      [SHARED_MODELS]: NVME,
      [CACHE_DIR]: NVME,
      [OUTPUT_DIR]: NVME,
      [APP_DATA]: NVME
    })

    await emitStorageTelemetry('inst-1')

    const props = capture.mock.calls[0]![1]
    expect(props.distinct_drive_count).toBe(1)
    expect(props.models_primary_same_drive_as_install).toBe(true)
    expect(props.models_all_same_drive_as_install).toBe(true)
    expect(props.any_models_on_hdd).toBe(false)
  })

  it('never ships raw paths in the event payload', async () => {
    stubClassification({
      [INSTALL_PATH]: NVME,
      [BUILTIN_MODELS]: NVME,
      [SHARED_MODELS]: HDD
    })

    await emitStorageTelemetry('inst-1')

    const serialized = JSON.stringify(capture.mock.calls[0]![1])
    for (const fragment of ['ComfyUI-Installs', 'D:\\\\ai', 'Users\\\\u', 'PHYSICALDRIVE']) {
      expect(serialized).not.toContain(fragment)
    }
  })

  it('null same-drive verdicts when a drive is unresolved, without faking a match', async () => {
    stubClassification({
      [INSTALL_PATH]: NVME,
      [BUILTIN_MODELS]: drive({}), // unresolved: driveKey null
      [SHARED_MODELS]: HDD
    })

    await emitStorageTelemetry('inst-1')

    const props = capture.mock.calls[0]![1]
    expect(props.models_drive_keys).toEqual([null, 1])
    expect(props.models_all_same_drive_as_install).toBeNull()
  })

  it('skips non-local sources', async () => {
    getInstallation.mockResolvedValue({ ...LOCAL_INST, sourceId: 'cloud' })
    await emitStorageTelemetry('inst-1')
    expect(capture).not.toHaveBeenCalled()
  })

  it('skips when the installation is missing or has no install path', async () => {
    getInstallation.mockResolvedValue(null)
    await emitStorageTelemetry('inst-1')
    getInstallation.mockResolvedValue({ ...LOCAL_INST, installPath: '' })
    await emitStorageTelemetry('inst-1')
    expect(capture).not.toHaveBeenCalled()
  })

  it('does not register person properties when detection failed', async () => {
    stubClassification({})
    await emitStorageTelemetry('inst-1')
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls[0]![1].install_storage_class).toBe('unknown')
    expect(registerPersonProperties).not.toHaveBeenCalled()
  })

  it('never throws when classification rejects', async () => {
    classifyPaths.mockRejectedValue(new Error('boom'))
    await expect(emitStorageTelemetry('inst-1')).resolves.toBeUndefined()
    expect(capture).not.toHaveBeenCalled()
  })
})
