import type {
  AppCard,
  HiddenAppCard,
  AssetSummary,
  CatalogWorkflow,
  CatalogWorkflowNeeds,
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
  chassisType: string
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
    chassisType: 'Notebook',
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
    chassisType: 'Desktop',
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
    chassisType: 'Desktop',
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
    covers: []
  },
  {
    id: 'background-remover',
    title: 'Background remover',
    description: 'Cut a subject out of its background in one step.',
    covers: []
  },
  {
    id: 'sketch-to-image',
    title: 'Sketch to image',
    description: 'Turn a rough drawing into a finished picture.',
    covers: []
  }
]

function catalogWorkflow(
  workflow: Pick<
    CatalogWorkflow,
    'id' | 'title' | 'description' | 'canOpenLocal' | 'canOpenCloud' | 'useCases' | 'models'
  >
): CatalogWorkflow {
  return {
    thumbnailUrl: null,
    minComfyUIVersion: null,
    hubUrl: `https://comfy.org/hub/workflows/${workflow.id}`,
    longDescription: null,
    author: 'ComfyUI',
    generationType: null,
    uses: null,
    license: null,
    publishedAt: null,
    media: [],
    tutorialUrl: null,
    ...workflow
  }
}

export const HIDDEN_APP_CARDS: HiddenAppCard[] = [
  {
    id: 'sample-app-alpha',
    title: 'Sample app alpha',
    description: 'A made-up app for the preview, with a page to open.',
    covers: [],
    reasons: ['hub_only'],
    page: 'live'
  },
  {
    id: 'sample-app-beta',
    title: 'Sample app beta',
    description: 'A made-up app for the preview that is off and still a draft.',
    covers: [],
    reasons: ['off', 'draft'],
    page: 'missing'
  },
  {
    id: 'sample-app-gamma',
    title: 'Sample app gamma',
    description: 'A made-up app for the preview that is not published.',
    covers: [],
    reasons: ['unpublished'],
    page: 'missing'
  }
]

export const HOME_WORKFLOWS: CatalogWorkflow[] = [
  catalogWorkflow({
    id: 'text-to-image',
    title: 'Text to image',
    description: 'Describe a picture and generate it.',
    canOpenLocal: true,
    canOpenCloud: true,
    useCases: ['generate-images'],
    models: ['Flux']
  }),
  catalogWorkflow({
    id: 'image-to-video',
    title: 'Image to video',
    description: 'Bring a still picture to life.',
    canOpenLocal: false,
    canOpenCloud: true,
    useCases: ['generate-video'],
    models: ['LTX-2.3']
  })
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

export const EXPLORE_WORKFLOWS: CatalogWorkflow[] = [
  {
    id: '0abf9ea8-7597-46f9-87e8-e38b0d94604a',
    title: 'Upscale and restore detail',
    description: 'Enlarge an image and restore fine detail with SeedVR2.',
    thumbnailUrl:
      'https://comfy.org/catalog-media/4b6f519f-c652-45fc-9c4c-44299dbc45a5/a973d96a-4ad9-46e0-9fdf-5a9e28bd6e1b',
    canOpenLocal: true,
    canOpenCloud: true,
    minComfyUIVersion: '0.3.66',
    hubUrl: 'https://comfy.org/hub/workflows/upscale-and-restore',
    longDescription: null,
    author: 'ComfyUI',
    generationType: 'edit-images',
    useCases: ['edit-images', 'upscale-and-restore'],
    models: ['SeedVR2'],
    uses: null,
    license: null,
    publishedAt: null,
    media: [
      {
        url: 'https://comfy.org/catalog-media/5ef747eb-0a72-4469-aea3-7692e266550f/8d77fc67-da00-43a2-b2c4-aeace5493d99',
        kind: 'image',
        width: 1920,
        height: 1088
      },
      {
        url: 'https://comfy.org/catalog-media/0ca2068a-41d7-44ef-98d1-35080ec1fa8e/b0b2ff3d-3c16-40eb-ab9f-fb05bc85ea5e',
        kind: 'image',
        width: 400,
        height: 400
      }
    ],
    tutorialUrl: null
  },
  {
    id: '7f3360b0-367b-436c-a496-e04d12f39ead',
    title: 'Change a material',
    description: 'Try a new fabric, texture, or finish on an object using a material reference.',
    thumbnailUrl:
      'https://comfy.org/catalog-media/2e8592e7-65ec-41ef-91b3-1a1710b3838d/bbb77ea5-10ef-4f66-a961-d780e3c96cbc',
    canOpenLocal: true,
    canOpenCloud: true,
    minComfyUIVersion: '0.16.4',
    hubUrl: 'https://comfy.org/hub/workflows/change-material',
    longDescription: null,
    author: 'ComfyUI',
    generationType: 'edit-images',
    useCases: ['edit-images', 'product-fashion-and-ads'],
    models: ['Qwen-Image-Edit'],
    uses: null,
    license: null,
    publishedAt: null,
    media: [
      {
        url: 'https://comfy.org/catalog-media/af0fa3c5-e00c-417b-bf91-d20575dabb58/524dfd59-62e1-4463-bbbe-d1a50dd31086',
        kind: 'image',
        width: 1320,
        height: 1320
      },
      {
        url: 'https://comfy.org/catalog-media/bbb1a62d-03f8-4ea2-a07d-3269c7023170/045c5fa1-1714-4a9a-8c9e-7cc47137d2e7',
        kind: 'image',
        width: 1392,
        height: 752
      },
      {
        url: 'https://comfy.org/catalog-media/4b981587-1d4c-48ac-8158-588a3c461e72/83a2ee52-7158-477f-9c2a-ede0b1e98c1f',
        kind: 'image',
        width: 1392,
        height: 752
      }
    ],
    tutorialUrl: null
  },
  {
    id: 'ad14ae6d-f3b8-464c-a88e-d768f799c242',
    title: 'Edit a selected region',
    description: 'Use an image, mask, and instruction to replace only the selected area.',
    thumbnailUrl:
      'https://comfy.org/catalog-media/054003a2-c3dd-4482-809a-e05cc93ea42c/60858eb8-13ff-4dab-85c2-b0d46f0050d6',
    canOpenLocal: true,
    canOpenCloud: true,
    minComfyUIVersion: '0.3.64',
    hubUrl: 'https://comfy.org/hub/workflows/edit-selected-region',
    longDescription: null,
    author: 'ComfyUI',
    generationType: 'edit-images',
    useCases: ['edit-images'],
    models: ['FLUX.1 Fill'],
    uses: null,
    license: null,
    publishedAt: null,
    media: [
      {
        url: 'https://comfy.org/catalog-media/79a6f5c8-c031-4beb-826b-eb0a00028cce/538263a4-5d51-447c-bef9-fe83b9cdee77',
        kind: 'image',
        width: 1024,
        height: 1024
      },
      {
        url: 'https://comfy.org/catalog-media/b7c1f635-6155-4c1c-aeb7-c25690f10c1a/7dce9e15-44f3-4ec6-8bf4-a645aa37c261',
        kind: 'image',
        width: 1024,
        height: 1024
      }
    ],
    tutorialUrl: null
  },
  {
    id: 'ae574655-5f6e-44c4-bd2a-cb8aa4dbbbc9',
    title: 'Turn an image into a video',
    description: 'Bring a still image to life by describing how it moves.',
    thumbnailUrl:
      'https://comfy.org/catalog-media/a2ec2ee6-e0cf-4589-8eb7-fb61dbeeb375/783423e9-fedf-468e-887b-99f5f88a08fb',
    canOpenLocal: true,
    canOpenCloud: true,
    minComfyUIVersion: '0.22.0',
    hubUrl: 'https://comfy.org/hub/workflows/image-to-video',
    longDescription: null,
    author: 'ComfyUI',
    generationType: 'animate-images',
    useCases: ['generate-video'],
    models: ['LTX-2.3'],
    uses: null,
    license: null,
    publishedAt: null,
    media: [
      {
        url: 'https://comfy.org/catalog-media/b4f91e9a-522c-405b-bfe5-6490d3ee6c80/9548616e-7676-45c5-a34c-b8641a1db949',
        kind: 'video',
        width: 1280,
        height: 704
      },
      {
        url: 'https://comfy.org/catalog-media/7a54cc6a-4977-47c7-ab0a-cbf3d6d79a1b/7fc249bc-107b-40a0-aac2-7bb2046d6224',
        kind: 'image',
        width: 350,
        height: 350
      }
    ],
    tutorialUrl: null
  },
  {
    id: 'bb82a512-a81c-45aa-8045-d3cd34045035',
    title: 'Copy movement from a video',
    description: 'Use a driving video to animate the character in your reference image.',
    thumbnailUrl:
      'https://comfy.org/catalog-media/cb37a7ba-d6f2-4716-b400-74cb0ebdfb34/8d83c3a8-8832-4831-b8ff-3f87db096076',
    canOpenLocal: true,
    canOpenCloud: true,
    minComfyUIVersion: '0.13.0',
    hubUrl: 'https://comfy.org/hub/workflows/motion-transfer',
    longDescription: null,
    author: 'ComfyUI',
    generationType: 'animate-images',
    useCases: ['animate-characters', 'vfx-and-motion-transfer'],
    models: ['Wan Animate'],
    uses: null,
    license: null,
    publishedAt: null,
    media: [
      {
        url: 'https://comfy.org/catalog-media/6db777ba-81b1-42ae-9a11-0f2978933d00/5d899a6a-ba38-441a-8758-36b94dccf795',
        kind: 'video',
        width: 956,
        height: 848
      },
      {
        url: 'https://comfy.org/catalog-media/6fb4e71b-d55e-488a-8b8a-586692b7be77/e00b7cab-b1ec-4e18-8dc0-9f19f177b363',
        kind: 'image',
        width: 350,
        height: 350
      }
    ],
    tutorialUrl: null
  },
  {
    id: '14b7e1d5-4969-4f70-ba14-106447e9527d',
    title: 'Create a video from references',
    description:
      'Combine two reference images into a video with consistent subjects and a scene you describe.',
    thumbnailUrl:
      'https://comfy.org/catalog-media/2c712b0d-c9c2-4c52-9a8c-93c234e2df26/0a62b297-c82a-4eae-a9c3-fd3b599034fb',
    canOpenLocal: true,
    canOpenCloud: true,
    minComfyUIVersion: '0.33.0',
    hubUrl: 'https://comfy.org/hub/workflows/video-from-references',
    longDescription: null,
    author: 'ComfyUI',
    generationType: 'generate-videos',
    useCases: ['generate-video'],
    models: ['MiniMax H3'],
    uses: null,
    license: null,
    publishedAt: null,
    media: [
      {
        url: 'https://comfy.org/catalog-media/6221478c-128e-49d6-aa76-828e2d5b61df/4e37a696-01b2-401b-a432-d79ede69b2db',
        kind: 'video',
        width: 864,
        height: 480
      },
      {
        url: 'https://comfy.org/catalog-media/94773ba5-872e-4abe-86f5-7d08b3bb026a/614db64b-7735-4aa5-892f-47d65f2ac9b4',
        kind: 'video',
        width: 1376,
        height: 768
      }
    ],
    tutorialUrl: null
  },
  {
    id: '42054f11-7d38-4d2d-a154-f08c5c803ff4',
    title: 'Upscale a video',
    description: 'Increase video resolution and restore detail across the clip.',
    thumbnailUrl:
      'https://comfy.org/catalog-media/c444aa42-8332-4d91-9141-3799bab8be9d/b6c5c6be-75b8-480f-a4ea-d718d0bda63c',
    canOpenLocal: true,
    canOpenCloud: true,
    minComfyUIVersion: '0.28.0',
    hubUrl: 'https://comfy.org/hub/workflows/upscale-video',
    longDescription: null,
    author: 'ComfyUI',
    generationType: 'edit-videos',
    useCases: ['upscale-and-restore', 'edit-video'],
    models: ['SeedVR2'],
    uses: null,
    license: null,
    publishedAt: null,
    media: [
      {
        url: 'https://comfy.org/catalog-media/e86cd870-dd13-4a27-8d14-11e879f86326/d06d29b6-7cb1-4664-814c-2e824764a2a9',
        kind: 'video',
        width: 1080,
        height: 1440
      },
      {
        url: 'https://comfy.org/catalog-media/d287731b-bf30-4f08-aea3-c90ed2ceb4d9/d5ac429f-05fe-41b1-8d89-853de9c6f68a',
        kind: 'image',
        width: 350,
        height: 350
      }
    ],
    tutorialUrl: null
  },
  {
    id: '4affe198-2de1-4313-943e-95fe75686718',
    title: 'Extend an image’s borders',
    description: 'Add space around an image and describe what should appear beyond its edges.',
    thumbnailUrl:
      'https://comfy.org/catalog-media/9b74ff56-0b8f-4327-a7b6-13a50a3a0712/d5e8f144-97f8-46b4-ae2e-8d26bbd0f50d',
    canOpenLocal: true,
    canOpenCloud: true,
    minComfyUIVersion: '0.3.64',
    hubUrl: 'https://comfy.org/hub/workflows/extend-image-borders',
    longDescription: null,
    author: 'ComfyUI',
    generationType: 'edit-images',
    useCases: ['edit-images'],
    models: ['FLUX.1 Fill'],
    uses: null,
    license: null,
    publishedAt: null,
    media: [
      {
        url: 'https://comfy.org/catalog-media/b10469d0-5621-43c8-9d13-026206aafc53/b2046af8-4b0c-40b3-948f-880ec1888feb',
        kind: 'image',
        width: 1824,
        height: 1424
      },
      {
        url: 'https://comfy.org/catalog-media/a668988c-5169-4518-8278-1255017bc3f6/7adb2698-454b-48ae-8a73-bf6b67dc14e6',
        kind: 'image',
        width: 400,
        height: 400
      }
    ],
    tutorialUrl: null
  }
]

function previewNode(
  id: number,
  type: string,
  pos: [number, number],
  slots: {
    inputs?: [string, string][]
    outputs?: [string, string][]
    widgets?: [string, unknown][]
  }
): Record<string, unknown> {
  const widgets = slots.widgets ?? []
  return {
    id,
    type,
    pos,
    size: [
      220,
      40 +
        Math.max(slots.inputs?.length ?? 0, slots.outputs?.length ?? 0) * 20 +
        widgets.length * 22
    ],
    inputs: [
      ...(slots.inputs ?? []).map(([name, type]) => ({ name, type, link: null })),
      ...widgets.map(([name]) => ({ name, type: 'COMBO', widget: { name }, link: null }))
    ],
    outputs: (slots.outputs ?? []).map(([name, type]) => ({ name, type, links: [] })),
    widgets_values: widgets.map(([, value]) => value)
  }
}

export const WORKFLOW_NEEDS: CatalogWorkflowNeeds = {
  graph: {
    nodes: [
      previewNode(1, 'CheckpointLoaderSimple', [0, 0], {
        outputs: [
          ['MODEL', 'MODEL'],
          ['CLIP', 'CLIP'],
          ['VAE', 'VAE']
        ],
        widgets: [['ckpt_name', 'ltx-2.3-22b-dev-fp8']]
      }),
      previewNode(2, 'LoadImage', [0, 200], {
        outputs: [['IMAGE', 'IMAGE']],
        widgets: [['image', 'portrait.png']]
      }),
      previewNode(3, 'CLIPTextEncode', [300, 0], {
        inputs: [['clip', 'CLIP']],
        outputs: [['CONDITIONING', 'CONDITIONING']],
        widgets: [['text', 'She turns toward the camera']]
      }),
      previewNode(4, 'LTXVImgToVideo', [300, 180], {
        inputs: [
          ['vae', 'VAE'],
          ['image', 'IMAGE']
        ],
        outputs: [['LATENT', 'LATENT']],
        widgets: [
          ['width', 1280],
          ['height', 720],
          ['length', 121]
        ]
      }),
      previewNode(5, 'KSampler', [600, 40], {
        inputs: [
          ['model', 'MODEL'],
          ['positive', 'CONDITIONING'],
          ['latent_image', 'LATENT']
        ],
        outputs: [['LATENT', 'LATENT']],
        widgets: [
          ['steps', 8],
          ['cfg', 1],
          ['sampler_name', 'euler']
        ]
      }),
      previewNode(6, 'VAEDecode', [900, 60], {
        inputs: [
          ['samples', 'LATENT'],
          ['vae', 'VAE']
        ],
        outputs: [['IMAGE', 'IMAGE']]
      }),
      previewNode(7, 'SaveVideo', [1180, 60], {
        inputs: [['images', 'IMAGE']],
        widgets: [['filename_prefix', 'ltx']]
      })
    ],
    links: [
      [1, 1, 0, 5, 0, 'MODEL'],
      [2, 1, 1, 3, 0, 'CLIP'],
      [3, 1, 2, 4, 0, 'VAE'],
      [4, 2, 0, 4, 1, 'IMAGE'],
      [5, 3, 0, 5, 1, 'CONDITIONING'],
      [6, 4, 0, 5, 2, 'LATENT'],
      [7, 5, 0, 6, 0, 'LATENT'],
      [8, 1, 2, 6, 1, 'VAE'],
      [9, 6, 0, 7, 0, 'IMAGE']
    ]
  },
  models: [
    {
      filename: 'ltx-2.3-22b-dev-fp8.safetensors',
      directory: 'checkpoints',
      sizeBytes: 29_145_431_166
    },
    {
      filename: 'ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors',
      directory: 'loras',
      sizeBytes: 2_741_024_390
    },
    {
      filename: 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors',
      directory: 'latent_upscale_models',
      sizeBytes: 995_743_560
    },
    {
      filename: 'gemma_3_12B_it_fp4_mixed.safetensors',
      directory: 'text_encoders',
      sizeBytes: 9_447_702_218
    }
  ],
  missingByBuild: {
    'inst-comfyui': [],
    'inst-video-experiments': [
      'checkpoints/ltx-2.3-22b-dev-fp8.safetensors',
      'text_encoders/gemma_3_12B_it_fp4_mixed.safetensors'
    ]
  }
}
