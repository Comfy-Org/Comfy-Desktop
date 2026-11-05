import { computed, reactive, ref, watch } from 'vue'
import { marUser, setUser } from '../userStates/userState'
import { can, MILESTONES } from '../../milestones'
import { go, newInstanceHooks, proto, toast } from '../../useProto'

/**
 * Local setup (UI Playground › Local setup): the proposed first install of
 * ComfyUI on this computer, behind its own tweak so the default prototype
 * keeps today's "New build flow" toast.
 *
 * The flow starts where Desktop starts today, unchanged:
 *  0. First launch: "How do you want to run Comfy?", Cloud or Local, terms
 *     and usage data. Local is picked by default. Cloud opens Comfy Cloud.
 *  1. Set up: today's Configure, summed up as what was detected and
 *     checked; Change opens every field. Low space asks, as today.
 *  2. Choose a starter workflow: today's template step, Skip & Install.
 *  3. Installing: today's install wait, the showcase scene and the Cloud
 *     pitch. Return to Dashboard asks, then cancels, as today.
 *  4. Ready: ComfyUI opens on its own, as today.
 *
 * `machine` picks what the checks find, so every state is one click away:
 * ready, an earlier install, not enough space, an Intel Mac, or an install
 * that fails halfway.
 */
export type LocalSetup = 'off' | 'on'
export type Machine = 'ready' | 'legacy' | 'lowdisk' | 'intel' | 'fails'
/** The computer the checks run on: its drawing, hardware and paths follow. */
export type SetupOs = 'mac' | 'windows' | 'linux'
/** The graphics a Windows or Linux computer has (a Mac's is its own chip). */
export type SetupGpu = 'nvidia' | 'amd' | 'intel' | 'cpu'
export type RunOnCards = 'glow' | 'row' | 'today'
export const RUN_ON_CARDS: { value: RunOnCards; label: string }[] = [
  { value: 'glow', label: 'Cards' },
  { value: 'row', label: 'Rows' },
  { value: 'today', label: 'Today' }
]
/** What the first release ships. M1: Builds only, so the install lands on
 *  All builds and the starter workflow stays a step of the setup, as today.
 *  Next: the Home exists and offers the starter workflows after the install
 *  (StarterShelf.vue). */
export type SetupScope = 'm1' | 'next'
export const SETUP_SCOPES: { value: SetupScope; label: string }[] = [
  { value: 'm1', label: 'M1' },
  { value: 'next', label: 'Next iterations' }
]
export type SetupStep = 'first' | 'setup' | 'change' | 'template' | 'installing' | 'error'

export const LOCAL_SETUPS: { value: LocalSetup; label: string }[] = [
  { value: 'off', label: 'Today' },
  { value: 'on', label: 'Proposal' }
]
export const MACHINES: { value: Machine; label: string }[] = [
  { value: 'ready', label: 'Ready to install' },
  { value: 'legacy', label: 'Earlier install found' },
  { value: 'lowdisk', label: 'Not enough space' },
  { value: 'intel', label: 'Intel Mac (unsupported)' },
  { value: 'fails', label: 'Install fails halfway' }
]

export const SETUP_OSES: { value: SetupOs; label: string }[] = [
  { value: 'mac', label: 'Mac' },
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux' }
]
export const SETUP_GPUS: { value: SetupGpu; label: string }[] = [
  { value: 'nvidia', label: 'NVIDIA' },
  { value: 'amd', label: 'AMD' },
  { value: 'intel', label: 'Intel Arc' },
  { value: 'cpu', label: 'No GPU (CPU)' }
]

const KEY = 'comfy.design.mar.localSetup'

function load(): {
  mode: LocalSetup
  machine: Machine
  cards: RunOnCards
  scope: SetupScope
  os: SetupOs
  gpu: SetupGpu
} {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      mode: v.mode === 'on' ? 'on' : 'off',
      machine: MACHINES.some((m) => m.value === v.machine) ? v.machine : 'ready',
      cards: RUN_ON_CARDS.some((c) => c.value === v.cards) ? v.cards : 'glow',
      scope: v.scope === 'next' ? 'next' : 'm1',
      os: SETUP_OSES.some((o) => o.value === v.os) ? v.os : 'mac',
      gpu: SETUP_GPUS.some((g) => g.value === v.gpu) ? v.gpu : 'nvidia'
    }
  } catch {
    return { mode: 'off', machine: 'ready', cards: 'glow', scope: 'm1', os: 'mac', gpu: 'nvidia' }
  }
}

export const localSetup = reactive(load())

/** The first screen's card options side by side (SetupCanvas.vue), from
 *  UI Playground › Local setup or `?canvas=first`. */
export const canvas = ref(new URLSearchParams(location.search).get('canvas') === 'first')

// `?setup=first` links straight to the proposed flow, on first launch.
const linkFirst = new URLSearchParams(location.search).get('setup') === 'first'
if (linkFirst) localSetup.mode = 'on'
// A link can pick the scope: `&scope=m1` or `&scope=next`.
const linkScope = new URLSearchParams(location.search).get('scope')
if (linkScope === 'm1' || linkScope === 'next') localSetup.scope = linkScope
// Without one, the shared link shows the first release: the install lands on Builds.
else if (linkFirst) localSetup.scope = 'm1'
// And the computer: `&os=windows` or `&os=linux`.
const linkOs = new URLSearchParams(location.search).get('os')
if (linkOs === 'mac' || linkOs === 'windows' || linkOs === 'linux') localSetup.os = linkOs
// And its graphics: `&gpu=amd`, `&gpu=intel` or `&gpu=cpu`.
const linkGpu = new URLSearchParams(location.search).get('gpu')
if (SETUP_GPUS.some((g) => g.value === linkGpu)) localSetup.gpu = linkGpu as SetupGpu

watch(
  () => ({ ...localSetup }),
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

/** The proposed flow replaces "New build flow" wherever the New UI is drawn. */
export const setupOn = computed(() => can.value.design && localSetup.mode === 'on')

// The scope is a milestone: M1 is Builds · MVP, where All builds is the
// landing; the next iterations are the latest one, with its Home.
const M1_MILESTONE = 2
const LATEST_MILESTONE = Number(MILESTONES.at(-1)!.value)
function showScope(): void {
  const m = localSetup.scope === 'm1' ? M1_MILESTONE : LATEST_MILESTONE
  if (proto.milestone !== m) proto.milestone = m
}

// What the checks find on each kind of computer (mock).
const COMPUTERS: Record<
  SetupOs,
  { chip: string; memGb: number; build: string; noun: string; path: string; otherPath: string }
> = {
  mac: {
    chip: 'Apple M3 Max',
    memGb: 36,
    build: 'Apple Silicon (MPS)',
    noun: 'this Mac',
    path: '~/ComfyUI-Installs/ComfyUI',
    otherPath: '/Volumes/Studio SSD/ComfyUI'
  },
  windows: {
    chip: 'NVIDIA GeForce RTX 4070',
    memGb: 32,
    build: 'NVIDIA',
    noun: 'this PC',
    path: 'C:\\Users\\You\\ComfyUI-Installs\\ComfyUI',
    otherPath: 'D:\\ComfyUI'
  },
  linux: {
    chip: 'NVIDIA GeForce RTX 4090',
    memGb: 64,
    build: 'NVIDIA',
    noun: 'this computer',
    path: '~/ComfyUI-Installs/ComfyUI',
    otherPath: '/mnt/studio-ssd/ComfyUI'
  }
}

// Today's hardware options off a Mac, as Configure names them.
const GRAPHICS: Record<SetupGpu, { chip?: string; build: string }> = {
  nvidia: { build: 'NVIDIA' },
  amd: { chip: 'AMD Radeon RX 7900 XTX', build: 'AMD' },
  intel: { chip: 'Intel Arc A770', build: 'Intel Arc (XPU)' },
  cpu: { chip: 'Intel Core i7-13700K', build: 'CPU' }
}
const computer = (): (typeof COMPUTERS)[SetupOs] => {
  const c = COMPUTERS[localSetup.os]
  if (localSetup.os === 'mac') return c
  const g = GRAPHICS[localSetup.gpu]
  return { ...c, chip: g.chip ?? c.chip, build: g.build }
}

/** What the checks found on this computer (mock, follows `machine`, `os` and
 *  `gpu`). */
export const DETECTED = reactive({
  ...computer(),
  version: 'v0.42.4',
  downloadGb: 1.2,
  freeGb: 412,
  lowFreeGb: 0.9,
  otherDisk: { name: 'Studio SSD', freeGb: 1600 }
})
watch(
  () => [localSetup.os, localSetup.gpu],
  () => Object.assign(DETECTED, computer())
)

export interface Starter {
  id: string
  title: string
  gb: number
  /** Runs on partner models: nothing to download, spends credits. */
  credits?: boolean
  tag?: string
  /** What it does, where the title doesn't say ("Name: Task"). */
  task?: string
  /** Image under mar/assets. */
  img: string
  /** Its template picture under mar/assets/templates, where there is one. */
  thumb?: string
}

/** The starter picker's four per tab (Desktop's curated list, sizes as shipped). */
export const STARTERS: Record<'image' | 'video' | '3d' | 'audio', Starter[]> = {
  image: [
    {
      id: 'zit',
      thumb: 'image_z_image_turbo',
      title: 'Z-Image-Turbo',
      task: 'Text to Image',
      gb: 20.8,
      tag: 'Recommended',
      img: 'portrait-garden.jpg'
    },
    {
      id: 'sdxl',
      thumb: 'image_krea2_turbo_t2i',
      title: 'SDXL Turbo',
      task: 'Text to Image',
      gb: 6.9,
      tag: 'Lightest',
      img: 'hills-sunset.jpg'
    },
    {
      id: 'pixeldit',
      thumb: 'image_flux2',
      title: 'PixelDiT: Text to Image',
      gb: 7.8,
      img: 'lake-fog.jpg'
    },
    {
      id: 'seedream',
      thumb: 'api_google_nano_banana2_image_edit',
      title: 'Seedream 5.0 Pro: Image Edit',
      gb: 0,
      credits: true,
      img: 'portrait-seaside.jpg'
    }
  ],
  video: [
    {
      id: 'minimax',
      thumb: 'video_minimax_h3_i2v',
      title: 'MiniMax H3: Text to Video',
      gb: 56.9,
      tag: 'Recommended',
      img: 'forest-fog.jpg'
    },
    {
      id: 'wan-inp',
      thumb: 'video_wan2_2_14B_i2v',
      title: 'Wan 2.1 Inpainting',
      task: 'Video Inpainting',
      gb: 11.4,
      img: 'portrait-window.jpg'
    },
    {
      id: 'wan-cam',
      thumb: 'video_ltx2_5_i2v',
      title: 'Wan 2.1 Fun Camera 1.3B',
      task: 'Camera Control',
      gb: 11.5,
      img: 'hills-fog.jpg'
    },
    {
      id: 'seedance',
      title: 'Seedance 2.5: Reference to Video',
      gb: 0,
      credits: true,
      img: 'portrait-sun.jpg'
    }
  ],
  '3d': [
    {
      id: 'triposplat',
      thumb: '3d_pixal3d_trellis2_image_to_model',
      title: 'TripoSplat: Image to Gaussian Splat',
      gb: 4.0,
      tag: 'Recommended',
      img: 'lake-fog.jpg'
    },
    {
      id: 'moge',
      title: 'MoGe: Perspective Geometry',
      gb: 0.6,
      tag: 'Lightest',
      img: 'hills-fog.jpg'
    },
    {
      id: 'hy3d',
      title: 'HY 3D 2.0 MV Turbo',
      task: 'Image to Model',
      gb: 4.9,
      img: 'forest-fog.jpg'
    },
    {
      id: 'tripo',
      title: 'Tripo H3.1: Image to Model',
      gb: 0,
      credits: true,
      img: 'portrait-smile.jpg'
    }
  ],
  audio: [
    {
      id: 'sa3',
      title: 'Stable Audio 3.0 Medium',
      task: 'Text to Audio',
      gb: 15.7,
      tag: 'Recommended',
      img: 'hills-sunset.jpg'
    },
    { id: 'sa1', title: 'Stable Audio 1.0', task: 'Text to Audio', gb: 5.7, img: 'lake-fog.jpg' },
    {
      id: 'ace',
      title: 'ACE-Step 1.5 Music',
      task: 'Text to Music',
      gb: 10.7,
      img: 'portrait-grass.jpg'
    },
    {
      id: 'seedaudio',
      title: 'Seed Audio 1.0: Text to Audio',
      gb: 0,
      credits: true,
      img: 'portrait-window.jpg'
    }
  ]
}

export const flow = reactive({
  open: false,
  step: 'setup' as SetupStep,
  running: false,
  percent: 0,
  tab: 'image' as keyof typeof STARTERS,
  picked: null as Starter | null,
  /** Location after Browse… picks another disk. */
  movedDisk: false,
  confirmCancel: false,
  /** Set up › Continue on a low disk: today's Low Disk Space warning. */
  confirmLowDisk: false,
  /** The install log, folded under the progress while it runs. */
  logs: false,
  /** The failing machine fails once; Retry then goes through. */
  retried: false,
  /** Earlier install: bring its files over (asked once, inline). */
  bringOver: true,
  /** First launch: Set up and the install stay full-window, before the
   *  Home exists, the way Desktop chains its first install today. */
  takeover: false
})

export const lowSpace = computed(() => localSetup.machine === 'lowdisk' && !flow.movedDisk)
// Only a Mac can be an Intel Mac.
export const unsupported = computed(() => localSetup.machine === 'intel' && localSetup.os === 'mac')

// Today's standalone install steps, in order.
const PHASES = [
  { until: 30, label: 'Download' },
  { until: 42, label: 'Extract' },
  { until: 82, label: 'Set up environment' },
  { until: 92, label: 'Clean up environment' },
  { until: 100, label: 'Update to latest stable' }
] as const
// A picked starter workflow adds its models as a last step, as today.
export const phases = computed<{ until: number; label: string }[]>(() =>
  flow.picked && !flow.picked.credits
    ? [
        ...PHASES.map((p) => ({ ...p, until: Math.round(p.until * 0.8) })),
        { until: 100, label: `Download ${flow.picked.title} models` }
      ]
    : [...PHASES]
)
export const phaseIndex = computed(() => phases.value.findIndex((p) => flow.percent < p.until))

let timer: ReturnType<typeof setInterval> | undefined

function stop(): void {
  if (timer) clearInterval(timer)
  timer = undefined
  flow.running = false
}

function tick(): void {
  flow.percent = Math.min(100, flow.percent + 1)
  if (localSetup.machine === 'fails' && !flow.retried && flow.percent === 46) {
    stop()
    flow.step = 'error'
    return
  }
  if (flow.percent >= 100) finish()
}

/** Finished: ComfyUI opens on its own, on the template if one was picked. */
function finish(): void {
  stop()
  marUser.local = 'one'
  flow.open = false
  // M1 has no Home: the install lands on All builds, in M1's own shell.
  showScope()
  go(localSetup.scope === 'm1' ? 'environments' : 'overview')
  toast(flow.picked ? `Opening ComfyUI with ${flow.picked.title}` : 'Opening ComfyUI')
}

/** Entry: the first launch, then every New Instance button. */
export function openSetup(): boolean {
  if (!setupOn.value) return false
  // Today's New Instance opens the install wizard directly.
  flow.step = marUser.local === 'none' ? 'first' : 'setup'
  flow.takeover = flow.step === 'first'
  flow.percent = 0
  flow.picked = null
  flow.movedDisk = false
  flow.confirmCancel = false
  flow.confirmLowDisk = false
  flow.logs = false
  flow.open = true
  return true
}

newInstanceHooks.push(openSetup)

/** First launch › Local: Set up, the one-click install. */
export function chooseLocal(): void {
  flow.step = 'setup'
}

/** First launch › Cloud: Desktop opens its Comfy Cloud entry. */
export function chooseCloud(): void {
  flow.open = false
  toast('Opening Comfy Cloud')
}

export function startInstall(): void {
  stop()
  flow.step = 'installing'
  flow.percent = 0
  flow.retried = false
  flow.confirmCancel = false
  flow.logs = false
  flow.running = true
  timer = setInterval(tick, 180)
}

export function retryInstall(): void {
  stop()
  flow.step = 'installing'
  flow.running = true
  flow.retried = true
  timer = setInterval(tick, 180)
}

/** The install stopped: Back returns to Set up to change something. */
export function backFromError(): void {
  stop()
  flow.step = 'setup'
  flow.percent = 0
}

/** Return to Dashboard, confirmed: the install stops and the Home shows. */
export function cancelInstall(): void {
  stop()
  flow.open = false
  flow.takeover = false
  flow.percent = 0
}

export function closeSetup(): void {
  // Closing while it installs is Return to Dashboard: it asks first.
  if (flow.running) flow.confirmCancel = true
  // Before the first install there is no Home yet: back to the first screen.
  else if (flow.takeover) flow.step = 'first'
  else flow.open = false
}

if (linkFirst) {
  showScope()
  setUser('first')
  openSetup()
}

/** Every screen of the flow, as the Figma comparison lists them, so a
 *  review can land on one without walking the flow. */
export type Screen =
  | 'first'
  | 'setup'
  | 'change'
  | 'template'
  | 'installing'
  | 'cancel'
  | 'error'
  | 'lowdisk'
  | 'intel'
  | 'builds'
export const SETUP_SCREENS: { value: Screen; label: string }[] = [
  { value: 'first', label: 'First launch' },
  { value: 'setup', label: 'Set up' },
  { value: 'change', label: 'Change setup' },
  { value: 'template', label: 'Starter workflow' },
  { value: 'installing', label: 'Installing' },
  { value: 'cancel', label: 'Return to Dashboard' },
  { value: 'error', label: 'Operation failed' },
  { value: 'lowdisk', label: 'Low Disk Space' },
  { value: 'intel', label: 'Unsupported Hardware' },
  { value: 'builds', label: 'Has builds' }
]

export function showScreen(s: Screen): void {
  stop()
  // The machine each state needs; the rest run on a ready computer.
  const machine: Partial<Record<Screen, Machine>> = {
    lowdisk: 'lowdisk',
    intel: 'intel',
    error: 'fails'
  }
  localSetup.mode = 'on'
  localSetup.machine = machine[s] ?? (localSetup.machine === 'legacy' ? 'legacy' : 'ready')
  marUser.local = s === 'builds' ? 'one' : 'none'
  Object.assign(flow, {
    open: true,
    takeover: s !== 'builds',
    percent: 0,
    picked: null,
    movedDisk: false,
    confirmCancel: s === 'cancel',
    confirmLowDisk: s === 'lowdisk',
    logs: false,
    retried: false
  })
  const step: Record<Screen, SetupStep> = {
    first: 'first',
    setup: 'setup',
    change: 'change',
    template: 'template',
    installing: 'installing',
    cancel: 'installing',
    error: 'error',
    lowdisk: 'setup',
    intel: 'setup',
    builds: 'setup'
  }
  flow.step = step[s]
  if (s === 'error') flow.percent = 46
  if (s === 'installing' || s === 'cancel') {
    flow.percent = 58
    flow.running = true
    timer = setInterval(tick, 180)
  }
}
