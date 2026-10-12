import { fn } from 'storybook/test'
import type { AuthStatus, DevPlatformBuild, ElectronApi, Source } from '../src/types/ipc'

export type InstallScenario =
  | 'publicBuilds'
  | 'managedBuilds'
  | 'noCompatibleBuilds'
  | 'buildLoadError'
  | 'installError'
  | 'lowDiskSpace'

const sources: Source[] = [
  {
    id: 'standalone',
    label: 'Public Builds',
    fields: [
      { id: 'release', label: 'Release', type: 'select' },
      { id: 'comfyVersion', label: 'ComfyUI version', type: 'select' },
      { id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' },
      { id: 'bundledTemplate', label: 'Starter Template', type: 'select', renderAs: 'cards' }
    ]
  },
  {
    id: 'remote',
    label: 'Remote Connection',
    skipInstall: true,
    hideInstallPath: true,
    fields: [{ id: 'url', label: 'URL', type: 'text', defaultValue: 'http://localhost:8188' }]
  }
]

const builds: DevPlatformBuild[] = [
  {
    id: 'studio-image',
    name: 'Studio Image Build',
    description: 'A published workspace setup for image workflows.',
    version: '3',
    state: 'installable',
    sizeBytes: 8_000_000_000,
    releaseTargets: [
      {
        artifactId: 'windows-nvidia',
        releaseVersion: 3,
        os: 'windows',
        gpu: 'nvidia',
        accelVariant: 'cu130',
        recommended: true
      },
      {
        artifactId: 'windows-cpu',
        releaseVersion: 3,
        os: 'windows',
        gpu: 'cpu',
        accelVariant: 'cpu',
        recommended: false
      }
    ]
  },
  {
    id: 'other-platform',
    name: 'Build for another platform',
    state: 'platform-mismatch',
    targetOs: ['linux']
  }
]

// Same data shape as the standalone source's variant cards.
function variantOption(variantId: string, label: string, sizeBytes: number, recommended = false) {
  const filename = `${variantId}.7z`
  return {
    value: variantId,
    label,
    description: `ComfyUI 0.3.92  ·  Python 3.12  ·  ${(sizeBytes / 1048576).toFixed(0)} MB`,
    recommended,
    data: {
      variantId,
      downloadFiles: [{ url: `https://example.com/${filename}`, filename, size: sizeBytes }]
    }
  }
}

/** Browser-only responses at the preload boundary. No Electron or backend is imported. */
export function createDesktopApi(scenario: InstallScenario): ElectronApi {
  let status: AuthStatus =
    scenario === 'publicBuilds' || scenario === 'lowDiskSpace'
      ? { signedIn: false }
      : signedInStatus()
  const authListeners = new Set<(status: AuthStatus) => void>()
  let buildRequests = 0

  function signedInStatus(workspaceId = 'storybook-personal'): AuthStatus {
    return {
      signedIn: true,
      workspaceId,
      workspaceName: 'Personal workspace',
      workspaceType: 'personal',
      email: 'preview@example.com'
    }
  }

  function changeAuth(next: AuthStatus): AuthStatus {
    status = next
    for (const listener of authListeners) listener(next)
    return next
  }

  const api = {
    platform: 'win32',
    getSources: async () => structuredClone(sources),
    getFieldOptions: async (_sourceId, fieldId) => {
      switch (fieldId) {
        case 'release':
          return [
            { value: 'stable', label: 'Stable', recommended: true },
            { value: 'latest', label: 'Latest' }
          ]
        case 'comfyVersion':
          return [{ value: 'v0.3.92', label: 'v0.3.92' }]
        case 'variant':
          return [
            variantOption('win-nvidia', 'NVIDIA', 3_000_000_000, true),
            variantOption('win-cpu', 'CPU', 1_000_000_000)
          ]
        case 'bundledTemplate':
          return [
            { value: 'none', label: 'None' },
            {
              value: 'starter-upscale',
              label: 'Starter Upscale Workflow',
              description: 'Upscale an existing image.',
              data: { modality: 'image', sizeBytes: 2_000_000_000, modelsPresent: false }
            },
            {
              value: 'starter-image',
              label: 'Starter Image Workflow',
              description: 'Generate an image from a text prompt.',
              data: { modality: 'image', sizeBytes: 20_000_000_000, modelsPresent: false }
            }
          ]
        default:
          throw new Error(`Add a Storybook fixture for field: ${fieldId}`)
      }
    },
    detectGPU: async () => ({ label: 'NVIDIA RTX 4090' }),
    validateHardware: async () => ({ supported: true }),
    checkNvidiaDriver: async () => null,
    getDefaultInstallDir: async () => 'C:\\ComfyUI-Installs',
    getUniqueName: async (name) => name,
    getSetting: async () => false,
    setSetting: fn(async () => {}),
    getInstallationsSummary: async () => ({
      localCount: 0,
      hasLaunchedCloud: false,
      hasLegacyDesktop: false
    }),
    getDiskSpace: async () => ({
      free: scenario === 'lowDiskSpace' ? 12_000_000_000 : 500_000_000_000,
      total: 1_000_000_000_000
    }),
    validateInstallPath: async () => [],
    browseFolder: fn(async () => 'C:\\Preview-Installs'),
    openPath: fn(async () => {}),
    openExternal: fn(async () => {}),
    buildInstallation: async (sourceId) => ({ sourceId }),
    // Public/remote submission stops at the boundary: no install is created.
    addInstallation: fn(async () => ({
      ok: false,
      message: 'Storybook preview: no installation was created.'
    })),
    installInstance: fn(async () => {}),
    comfybuilder: {
      getAuthStatus: async () => status,
      signIn: fn(async () => changeAuth(signedInStatus())),
      signOut: fn(async () => changeAuth({ signedIn: false })),
      switchWorkspace: fn(async (workspaceId) => changeAuth(signedInStatus(workspaceId))),
      onAuthChanged(callback) {
        authListeners.add(callback)
        return () => {
          authListeners.delete(callback)
        }
      },
      listWorkspaces: async () => [
        { id: 'storybook-personal', name: 'Personal workspace', type: 'personal', role: 'owner' }
      ],
      listBuilds: fn(async () => {
        if (scenario === 'buildLoadError' && ++buildRequests === 1) {
          throw new Error('Sample workspace request failed')
        }
        return structuredClone(
          scenario === 'noCompatibleBuilds'
            ? builds.filter((b) => b.state !== 'installable')
            : builds
        )
      }),
      openBuildsPage: fn(async () => {}),
      installBuild: fn(async () =>
        scenario === 'installError'
          ? { ok: false, message: 'This build is not compatible with this machine.' }
          : { ok: true, entry: { id: 'preview-install', name: 'Studio Image Build' } }
      )
    }
  } satisfies Partial<Omit<ElectronApi, 'comfybuilder'>> & {
    comfybuilder: Partial<ElectronApi['comfybuilder']>
  }

  // Only the methods used by these screens are provided. An unexpected call
  // fails rather than silently returning a fabricated success.
  return api as unknown as ElectronApi
}
