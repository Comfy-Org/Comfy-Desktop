import { reactive } from 'vue'
import type { ProtoInstance } from '../../mock'

/**
 * What a build's page knows beyond the shared mock (mock.ts): the facts an
 * install reports (Python, PyTorch, where it lives, disk), the newest
 * release on its channel, and its settings (how it starts, where it keeps
 * models, inputs and outputs). Prototype data only.
 */
export interface BuildFacts {
  python: string
  torch: string
  path: string
  disk: string
  /** Newest ComfyUI on the build's channel. */
  latest: string
  checked: string
}

const FACTS: Record<string, Partial<BuildFacts>> = {
  'local-1': { latest: 'v0.37.6', checked: '2 h ago' },
  'local-video': { torch: '2.10.0.dev20261101 · MPS', checked: '35 min ago' },
  'local-flux': { checked: 'Yesterday' }
}

export function factsOf(b: ProtoInstance): BuildFacts {
  const cloud = b.kind !== 'local'
  return {
    python: '3.12.9',
    torch: cloud ? '2.9.0 · CUDA 12.8' : '2.9.0 · MPS',
    path: cloud ? 'Comfy Cloud' : `~/Documents/ComfyUI/${b.name}`,
    disk: b.diskSize ?? '—',
    latest: b.version ?? 'Latest',
    checked: 'Just now',
    ...FACTS[b.id]
  }
}

export const CHANNELS = [
  { value: 'Stable', label: 'Stable' },
  { value: 'Nightly', label: 'Nightly' }
]

/* ---- Settings ---- */
export type LaunchMode = 'window' | 'browser' | 'background'
export type Listen = 'local' | 'network'
export type SecurityLevel = 'strong' | 'normal' | 'normal-' | 'weak'
export type NetworkMode = 'public' | 'private' | 'offline' | 'personal_cloud'

export interface BuildSettings {
  args: string
  mode: LaunchMode
  port: string
  listen: Listen
  env: { key: string; value: string }[]
  manager: boolean
  security: SecurityLevel
  network: NetworkMode
  gitInstall: boolean
  pipInstall: boolean
  modelFolders: { path: string; own?: boolean }[]
  input: string
  output: string
  shared: boolean
}

export const LAUNCH_MODES = [
  { value: 'window' as const, label: 'In the app' },
  { value: 'browser' as const, label: 'In your browser' },
  { value: 'background' as const, label: 'In the background' }
]
export const LISTEN = [
  { value: 'local' as const, label: 'This computer only' },
  { value: 'network' as const, label: 'Your local network' }
]
export const SECURITY = [
  { value: 'strong' as const, label: 'Strong' },
  { value: 'normal' as const, label: 'Normal' },
  { value: 'normal-' as const, label: 'Normal-' },
  { value: 'weak' as const, label: 'Weak' }
]
export const NETWORK = [
  { value: 'public' as const, label: 'Public' },
  { value: 'private' as const, label: 'Private' },
  { value: 'offline' as const, label: 'Offline' },
  { value: 'personal_cloud' as const, label: 'Personal cloud' }
]

// One settings object per build, kept while the prototype runs.
const SETTINGS = new Map<string, BuildSettings>()

export function settingsOf(b: ProtoInstance): BuildSettings {
  let s = SETTINGS.get(b.id)
  if (!s) {
    const home = `~/Documents/ComfyUI/${b.name}`
    s = reactive<BuildSettings>({
      args: b.id === 'local-video' ? '--use-sage-attention --preview-method auto' : '',
      mode: 'window',
      port: String(8188 + Math.max(0, ['local-1', 'local-video', 'local-flux'].indexOf(b.id))),
      listen: 'local',
      env:
        b.id === 'local-video'
          ? [
              { key: 'PYTORCH_ENABLE_MPS_FALLBACK', value: '1' },
              { key: 'HF_HOME', value: '~/AI/huggingface' }
            ]
          : [{ key: 'PYTORCH_ENABLE_MPS_FALLBACK', value: '1' }],
      manager: true,
      security: 'normal',
      network: 'public',
      gitInstall: false,
      pipInstall: false,
      modelFolders: [{ path: `${home}/models`, own: true }, { path: '~/AI/models' }],
      input: '~/AI/input',
      output: '~/AI/output',
      shared: true
    })
    SETTINGS.set(b.id, s)
  }
  return s
}
