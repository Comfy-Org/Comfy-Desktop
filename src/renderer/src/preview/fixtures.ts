import type {
  AppCard,
  AssetSummary,
  CatalogWorkflow,
  FieldOption,
  GPUInfo,
  Installation,
  ProgressStep,
  Source,
  SystemInfo
} from '../../../types/ipc'

export const GB = 1024 ** 3

export type PreviewPlatform = 'darwin' | 'win32' | 'linux'

export interface PreviewMachine {
  platform: PreviewPlatform
  systemInfo: SystemInfo
  gpu: GPUInfo
  installRoot: string
  diskFreeBytes: number
  diskTotalBytes: number
  variants: FieldOption[]
}

const SHARED_SYSTEM_INFO = {
  gpus: [],
  amd_driver_version: null,
  intel_driver_version: null,
  electron_version: '45.3.2',
  chrome_version: '142.0.7444.59',
  app_version: '1.1.10',
  auto_update: true,
  locale: 'en',
  installation_count: 0,
  installations: []
} satisfies Partial<SystemInfo>

function variantOption(
  variantId: string,
  label: string,
  downloadBytes: number,
  recommended = false
): FieldOption {
  return {
    value: variantId,
    label,
    recommended,
    data: { variantId, downloadFiles: downloadBytes ? [{ size: downloadBytes }] : [] }
  }
}

const MACHINES: Record<PreviewPlatform, PreviewMachine> = {
  darwin: {
    platform: 'darwin',
    systemInfo: {
      ...SHARED_SYSTEM_INFO,
      gpu_vendor: 'apple',
      gpu_label: 'Apple M3 Max',
      gpu_model: 'Apple M3 Max',
      gpu_vram_mb: null,
      gpu_vram_gb: null,
      gpu_tier: 'apple',
      nvidia_driver_version: null,
      nvidia_driver_supported: null,
      platform: 'darwin',
      arch: 'arm64',
      os_version: '15.1',
      os_distro: 'macOS',
      os_release: '15.1',
      os_arch: 'arm64',
      total_memory_gb: 36,
      cpu_model: 'Apple M3 Max',
      cpu_cores: 14,
      cpu_physical_cores: 14,
      cpu_speed_ghz: null,
      cpu_manufacturer: 'Apple'
    },
    gpu: { id: 'mps', label: 'Apple Silicon (MPS)', model: 'Apple M3 Max' },
    installRoot: '/Users/ada/ComfyUI-Installs',
    diskFreeBytes: 412 * GB,
    diskTotalBytes: 1000 * GB,
    variants: [
      variantOption('mac-mps', 'Apple Silicon (MPS)', 1.2 * GB, true),
      variantOption('mac-cpu', 'CPU', 0)
    ]
  },
  win32: {
    platform: 'win32',
    systemInfo: {
      ...SHARED_SYSTEM_INFO,
      gpu_vendor: 'nvidia',
      gpu_label: 'NVIDIA',
      gpu_model: 'NVIDIA GeForce RTX 4090',
      gpu_vram_mb: 24576,
      gpu_vram_gb: 24,
      gpu_tier: 'high',
      nvidia_driver_version: '580.88',
      nvidia_driver_supported: true,
      platform: 'win32',
      arch: 'x64',
      os_version: '10.0.26200',
      os_distro: 'Microsoft Windows 11 Pro',
      os_release: '10.0.26200',
      os_arch: '64-bit',
      total_memory_gb: 64,
      cpu_model: 'AMD Ryzen 9 7950X',
      cpu_cores: 32,
      cpu_physical_cores: 16,
      cpu_speed_ghz: 4.5,
      cpu_manufacturer: 'AMD'
    },
    gpu: { id: 'nvidia', label: 'NVIDIA', model: 'NVIDIA GeForce RTX 4090' },
    installRoot: 'C:\\Users\\ada\\ComfyUI-Installs',
    diskFreeBytes: 733 * GB,
    diskTotalBytes: 1863 * GB,
    variants: [
      variantOption('win-nvidia', 'NVIDIA', 4.6 * GB, true),
      variantOption('win-amd', 'AMD', 3.1 * GB),
      variantOption('win-intel-xpu', 'Intel Arc', 3.4 * GB),
      variantOption('win-cpu', 'CPU', 0.9 * GB)
    ]
  },
  linux: {
    platform: 'linux',
    systemInfo: {
      ...SHARED_SYSTEM_INFO,
      gpu_vendor: 'nvidia',
      gpu_label: 'NVIDIA',
      gpu_model: 'NVIDIA GeForce RTX 3060',
      gpu_vram_mb: 12288,
      gpu_vram_gb: 12,
      gpu_tier: 'mid',
      nvidia_driver_version: '570.133',
      nvidia_driver_supported: true,
      platform: 'linux',
      arch: 'x64',
      os_version: '6.8.0',
      os_distro: 'Ubuntu',
      os_release: '24.04',
      os_arch: 'x64',
      total_memory_gb: 32,
      cpu_model: 'Intel Core i7-12700K',
      cpu_cores: 20,
      cpu_physical_cores: 12,
      cpu_speed_ghz: 3.6,
      cpu_manufacturer: 'Intel'
    },
    gpu: { id: 'nvidia', label: 'NVIDIA', model: 'NVIDIA GeForce RTX 3060' },
    installRoot: '/home/ada/ComfyUI-Installs',
    diskFreeBytes: 188 * GB,
    diskTotalBytes: 512 * GB,
    variants: [
      variantOption('linux-nvidia', 'NVIDIA', 4.4 * GB, true),
      variantOption('linux-amd', 'AMD', 3.0 * GB),
      variantOption('linux-cpu', 'CPU', 0.9 * GB)
    ]
  }
}

export function previewMachine(platform: PreviewPlatform): PreviewMachine {
  return MACHINES[platform]
}

export function isPreviewPlatform(value: string | null): value is PreviewPlatform {
  return value === 'darwin' || value === 'win32' || value === 'linux'
}

export const LATEST_STABLE_TAG = 'v0.42.4'

export const RELEASE_OPTIONS: FieldOption[] = [
  {
    value: 'stable',
    label: 'Stable',
    recommended: true,
    data: { latestStableTag: LATEST_STABLE_TAG }
  },
  { value: 'latest', label: 'Latest on GitHub', data: {} }
]

export const COMFY_VERSION_OPTIONS: FieldOption[] = [
  { value: LATEST_STABLE_TAG, label: LATEST_STABLE_TAG, recommended: true },
  { value: 'v0.42.3', label: 'v0.42.3' },
  { value: 'v0.42.2', label: 'v0.42.2' }
]

export const SOURCES: Source[] = [
  {
    id: 'standalone',
    label: 'Standalone',
    category: 'local',
    description: 'A self-contained ComfyUI with its own Python.',
    fields: [
      { id: 'release', label: 'Release', type: 'select' },
      { id: 'comfyVersion', label: 'Version', type: 'select' },
      { id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' }
    ]
  },
  {
    id: 'remote',
    label: 'Remote server',
    category: 'remote',
    description: 'Connect to a ComfyUI that is already running.',
    skipInstall: true,
    hideInstallPath: true,
    fields: [{ id: 'url', label: 'Address', type: 'text', defaultValue: 'http://127.0.0.1:8188' }]
  }
]

export function fieldOptionsFor(machine: PreviewMachine, fieldId: string): FieldOption[] {
  if (fieldId === 'release') return RELEASE_OPTIONS
  if (fieldId === 'comfyVersion') return COMFY_VERSION_OPTIONS
  if (fieldId === 'variant') return machine.variants
  return []
}

function joinPath(machine: PreviewMachine, name: string): string {
  return `${machine.installRoot}${machine.platform === 'win32' ? '\\' : '/'}${name}`
}

export function localBuild(
  machine: PreviewMachine,
  overrides: Partial<Installation> & { name: string }
): Installation {
  const id = overrides.id ?? `inst-${overrides.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return {
    id,
    sourceId: 'standalone',
    sourceLabel: 'Standalone',
    sourceCategory: 'local',
    version: LATEST_STABLE_TAG,
    status: 'installed',
    seen: true,
    installPath: joinPath(machine, overrides.name),
    createdAt: '2026-10-02T17:20:00.000Z',
    lastLaunchedAt: Date.parse('2026-11-14T09:30:00.000Z'),
    ...overrides
  }
}

export function cloudBuild(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'inst-comfy-cloud',
    name: 'Comfy Cloud',
    sourceId: 'cloud',
    sourceLabel: 'Comfy Cloud',
    sourceCategory: 'cloud',
    status: 'installed',
    seen: true,
    listPreview: 'https://cloud.comfy.org',
    createdAt: '2026-09-18T12:00:00.000Z',
    ...overrides
  }
}

export function everydayBuilds(machine: PreviewMachine): Installation[] {
  return [
    localBuild(machine, { name: 'ComfyUI' }),
    localBuild(machine, {
      name: 'Video experiments',
      version: 'v0.42.2',
      createdAt: '2026-10-20T08:00:00.000Z',
      lastLaunchedAt: Date.parse('2026-11-09T19:10:00.000Z'),
      statusTag: { style: 'update', label: 'Update available', version: LATEST_STABLE_TAG }
    }),
    cloudBuild()
  ]
}

export const INSTALL_STEPS: ProgressStep[] = [
  { phase: 'download', label: 'Download' },
  { phase: 'extract', label: 'Extract' },
  { phase: 'setup', label: 'Set up environment' },
  { phase: 'update', label: `Get ComfyUI ${LATEST_STABLE_TAG}` }
]

export const APP_CARDS: AppCard[] = [
  {
    id: 'image-upscaler',
    title: 'Image upscaler',
    description: 'Make a small picture four times larger without losing detail.',
    coverUrl: null
  },
  {
    id: 'background-remover',
    title: 'Background remover',
    description: 'Cut a subject out of its background in one step.',
    coverUrl: null
  },
  {
    id: 'sketch-to-image',
    title: 'Sketch to image',
    description: 'Turn a rough drawing into a finished picture.',
    coverUrl: null
  }
]

export const HOME_WORKFLOWS: CatalogWorkflow[] = [
  {
    id: 'text-to-image',
    title: 'Text to image',
    description: 'Describe a picture and generate it.',
    thumbnailUrl: null,
    canOpenLocal: true,
    canOpenCloud: true,
    minComfyUIVersion: null
  },
  {
    id: 'image-to-video',
    title: 'Image to video',
    description: 'Bring a still picture to life.',
    thumbnailUrl: null,
    canOpenLocal: false,
    canOpenCloud: true,
    minComfyUIVersion: null
  }
]

export function localAssets(): AssetSummary[] {
  return ['harbor-at-dusk.png', 'paper-crane.png', 'studio-portrait.png'].map((name, index) => ({
    id: `asset-${index + 1}`,
    name,
    kind: 'image',
    sizeBytes: (index + 2) * 1024 * 1024,
    createdAt: `2026-11-1${index}T10:00:00.000Z`,
    mimeType: 'image/png',
    tags: [],
    previewUrl: null,
    thumbnailUrl: null,
    width: 1024,
    height: 1024,
    durationSeconds: null
  }))
}
