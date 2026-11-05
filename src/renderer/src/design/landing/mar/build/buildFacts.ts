import { reactive, ref } from 'vue'
import type { ProtoInstance } from '../../mock'
import { toast } from '../../useProto'
import { notify } from '../pages/undo'

/**
 * What a build's page knows beyond the shared mock (mock.ts), for the
 * Builds milestone, where the page keeps today's Desktop tabs: the facts
 * an install reports (About), its channel and the newest ComfyUI (Update),
 * its ComfyUI-Manager snapshots, and its settings (Startup, Storage).
 * Names and options are production's (locales/en.json). Prototype data,
 * kept per build while the prototype runs.
 */
export interface BuildFacts {
  method: string
  hardware: string
  python: string
  torch: string
  path: string
  disk: string
  /** Newest ComfyUI on each channel. */
  latest: { stable: string; latest: string }
  checked: string
}

const FACTS: Record<string, Partial<BuildFacts>> = {
  'local-1': { latest: { stable: 'v0.37.6', latest: 'v0.37.6-12-g4f2a91c' }, checked: '2 h ago' },
  'local-video': {
    torch: '2.10.0.dev20261101 (MPS)',
    latest: { stable: 'v0.37.6', latest: 'v0.38.0-dev' },
    checked: '35 min ago'
  },
  'local-flux': { checked: 'Yesterday' }
}

export function factsOf(b: ProtoInstance): BuildFacts {
  return {
    method: b.kind === 'local' ? 'Standalone' : 'Comfy Cloud',
    hardware: b.gpu?.includes('Apple') ? 'Apple Silicon (MPS)' : 'NVIDIA (CUDA)',
    python: '3.12.9',
    torch: b.gpu?.includes('Apple') ? '2.9.0 (MPS)' : '2.9.0+cu128',
    path: b.kind === 'local' ? `~/Documents/ComfyUI/${b.name}` : 'Comfy Cloud',
    disk: b.diskSize ?? '—',
    latest: { stable: b.version ?? 'Latest', latest: `${b.version ?? 'v0.37.4'}-8-g91be0d3` },
    checked: 'Just now',
    ...FACTS[b.id]
  }
}

/* ---- Version and updates ---- */
export type Channel = 'stable' | 'latest'
export const CHANNELS: { value: Channel; label: string; hint: string }[] = [
  { value: 'stable', label: 'Stable', hint: 'Tested releases' },
  { value: 'latest', label: 'Latest on GitHub', hint: 'Newest commit on master' }
]

const initialChannel = (b: ProtoInstance): Channel =>
  b.channel === 'Nightly' ? 'latest' : 'stable'

export interface BuildState {
  version: string
  channel: Channel
  updating: boolean
  /** Changed while running: the header's button says Restart to apply changes. */
  restart: boolean
  /** Renamed on its page. */
  name: string
  /** Started or stopped from its page. */
  run: ProtoInstance['state']
}
const STATES = new Map<string, BuildState>()

/** The build's version and channel, shared by its header and tabs. */
export function stateOf(b: ProtoInstance): BuildState {
  let s = STATES.get(b.id)
  if (!s) {
    s = reactive<BuildState>({
      version: b.version ?? 'Latest',
      channel: initialChannel(b),
      updating: false,
      restart: false,
      name: b.name,
      run: b.state
    })
    STATES.set(b.id, s)
  }
  return s
}

/** The newer ComfyUI on a channel, when it is the build's channel and the
 *  build is behind it (a build marked "update" on the one it started on). */
export function nextOn(b: ProtoInstance, c: Channel): string | undefined {
  const s = stateOf(b)
  const next = factsOf(b).latest[c]
  if (c !== s.channel || s.version === next) return undefined
  if (c === initialChannel(b) && b.state !== 'update') return undefined
  return next
}

/** The newer ComfyUI on the build's channel, if there is one. */
export function pendingOf(b: ProtoInstance): string | undefined {
  return nextOn(b, stateOf(b).channel)
}

export function updateBuild(b: ProtoInstance, channel?: Channel): void {
  const s = stateOf(b)
  if (channel) s.channel = channel
  const next = factsOf(b).latest[s.channel]
  s.updating = true
  setTimeout(() => {
    const was = s.version
    s.version = next
    s.updating = false
    notify(`${b.name} is on ComfyUI ${next}`, () => (s.version = was))
  }, 1600)
}

/** Forget or Uninstall from a build's page, for the Builds list to carry out. */
export const leaving = ref<string>()

/* ---- Snapshots (ComfyUI-Manager's) ---- */
export type Trigger = 'boot' | 'manual' | 'pre-update' | 'restart'
export const TRIGGERS: Record<Trigger, string> = {
  boot: 'Boot',
  manual: 'Manual',
  'pre-update': 'Pre-Update',
  restart: 'Manager Restart'
}
export interface Snapshot {
  id: string
  label?: string
  trigger: Trigger
  when: string
  comfy: string
  nodes: number
  pkgs: number
}

const SNAPS = new Map<string, Snapshot[]>()

export function snapshotsOf(b: ProtoInstance): Snapshot[] {
  let list = SNAPS.get(b.id)
  if (!list) {
    const v = b.version ?? 'v0.37.4'
    const n = b.nodes ?? 4
    list = reactive<Snapshot[]>(
      b.kind !== 'local'
        ? []
        : (
            [
              { id: 's5', trigger: 'boot', when: b.lastUsed, comfy: v, nodes: n, pkgs: 212 },
              {
                id: 's4',
                label: 'before-lora-pack',
                trigger: 'manual',
                when: 'Yesterday',
                comfy: v,
                nodes: n - 1,
                pkgs: 209
              },
              {
                id: 's3',
                trigger: 'pre-update',
                when: 'Last week',
                comfy: 'v0.37.2',
                nodes: n - 1,
                pkgs: 207
              },
              {
                id: 's2',
                trigger: 'restart',
                when: '2 weeks ago',
                comfy: 'v0.37.2',
                nodes: n - 2,
                pkgs: 201
              },
              { id: 's1', trigger: 'boot', when: 'Aug 2', comfy: 'v0.37.0', nodes: 2, pkgs: 188 }
            ] as Snapshot[]
          ).filter((s) => s.nodes >= 0)
    )
    SNAPS.set(b.id, list)
  }
  return list
}

export function createSnapshot(b: ProtoInstance, label?: string): void {
  const list = snapshotsOf(b)
  list.unshift({
    id: `s${Date.now()}`,
    label: label?.trim() || undefined,
    trigger: 'manual',
    when: 'Just now',
    comfy: stateOf(b).version,
    nodes: list[0]?.nodes ?? b.nodes ?? 0,
    pkgs: list[0]?.pkgs ?? 200
  })
  toast('Snapshot created')
}
export function restoreSnapshot(b: ProtoInstance, id: string): void {
  const s = snapshotsOf(b).find((x) => x.id === id)
  if (s) toast(`Rolled back to ${s.label ?? TRIGGERS[s.trigger]} · ${s.when}`)
}
export function deleteSnapshot(b: ProtoInstance, id: string): void {
  const list = snapshotsOf(b)
  const i = list.findIndex((x) => x.id === id)
  const s = list.splice(i, 1)[0]!
  notify('Snapshot deleted', () => list.splice(i, 0, s))
}

/* ---- Settings: production's Launch Settings and Storage ---- */
export type LaunchMode = 'window' | 'console'
export type Partition = 'shared' | 'unique'
export type PortConflict = 'ask' | 'auto'
export type SecurityLevel = 'strong' | 'normal' | 'weak'
export type NetworkMode = 'public' | 'private' | 'offline' | 'personal_cloud'

export interface BuildSettings {
  args: string
  mode: LaunchMode
  partition: Partition
  portConflict: PortConflict
  env: { key: string; value: string }[]
  security: SecurityLevel
  network: NetworkMode
  sharedModels: boolean
  modelDirs: string[]
  sharedInput: boolean
  inputDir: string
  sharedOutput: boolean
  outputDir: string
}

export const LAUNCH_MODES = [
  { value: 'window' as const, label: 'App window' },
  { value: 'console' as const, label: 'Console only' }
]
export const PARTITIONS = [
  { value: 'shared' as const, label: 'Shared' },
  { value: 'unique' as const, label: 'Unique to this instance' }
]
export const PORT_CONFLICT = [
  { value: 'ask' as const, label: 'Ask what to do' },
  { value: 'auto' as const, label: 'Use next available port' }
]
export const SECURITY = [
  {
    value: 'strong' as const,
    label: 'Strict',
    hint: 'Blocks all node pack installs, updates and uninstalls.'
  },
  {
    value: 'normal' as const,
    label: 'Standard (recommended)',
    hint: 'Allows registered node packs. Blocks installs from unregistered sources.'
  },
  {
    value: 'weak' as const,
    label: 'Permissive',
    hint: 'Allows every risk tier, including unregistered sources.'
  }
]
export const NETWORK = [
  {
    value: 'public' as const,
    label: 'Public (default)',
    hint: 'Uses the public node registry over the internet.'
  },
  {
    value: 'private' as const,
    label: 'Private',
    hint: 'Uses a private node database you configure.'
  },
  { value: 'offline' as const, label: 'Offline', hint: 'Makes no external network connections.' },
  {
    value: 'personal_cloud' as const,
    label: 'Personal cloud',
    hint: 'Lifts the --listen block on node pack installs. Only on a machine you control.'
  }
]

const SETTINGS = new Map<string, BuildSettings>()

export function settingsOf(b: ProtoInstance): BuildSettings {
  let s = SETTINGS.get(b.id)
  if (!s) {
    const home = `~/Documents/ComfyUI/${b.name}`
    s = reactive<BuildSettings>({
      args:
        b.id === 'local-video'
          ? '--use-sage-attention --preview-method auto'
          : '--preview-method auto',
      mode: 'window',
      partition: 'shared',
      portConflict: 'ask',
      env: [{ key: 'PYTORCH_ENABLE_MPS_FALLBACK', value: '1' }],
      security: 'normal',
      network: 'public',
      sharedModels: true,
      modelDirs: [`${home}/models`],
      sharedInput: true,
      inputDir: `${home}/input`,
      sharedOutput: true,
      outputDir: `${home}/output`
    })
    SETTINGS.set(b.id, s)
  }
  return s
}
