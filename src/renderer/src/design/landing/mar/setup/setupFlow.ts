import { computed, nextTick, reactive, ref, watch } from 'vue'
import { marUser, setUser } from '../userStates/userState'
import { can } from '../../milestones'
import { go, hostActions, instances, newInstanceHooks, proto, toast } from '../../useProto'

/**
 * Local setup (UI Playground › Local setup): the proposed first install of
 * ComfyUI on this computer, behind its own tweak so the default prototype
 * keeps today's "New build flow" toast.
 *
 * The flow starts where Desktop starts today, unchanged:
 *  0. First launch: "How do you want to run ComfyUI?", Cloud or Local, terms
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
/** How the first launch goes once the Home exists. Install first: today's
 *  steps, ending in the install. The two Home first options make Run on the
 *  only step and land on the Home, where the install waits on a card
 *  (HomeInstall.vue); they differ in what the Home offers before a build
 *  exists. Install card: only the card, nothing that needs ComfyUI. Home
 *  open: the first-run Home stays around the card. Off by default, and
 *  only where there is a Home. */
export type Onboarding = 'install' | 'home-running' | 'home-direct' | 'home' | 'home-open'
export const ONBOARDINGS: { value: Onboarding; label: string }[] = [
  { value: 'install', label: 'Install first (today)' },
  { value: 'home-running', label: 'Home first: install runs behind' },
  { value: 'home-direct', label: 'Home first: Run on only, install runs' },
  { value: 'home', label: 'Home first: install card only' },
  { value: 'home-open', label: 'Home first: Home stays open' }
]
export type SetupStep = 'first' | 'setup' | 'change' | 'nodes' | 'template' | 'installing' | 'error'
/** Custom nodes with the install (DESK-243): where a new user gets the
 *  recommended node packs, if anywhere, while it is decided. New build: a
 *  step after Set up, every new build but the first. Home: the first
 *  install's card on the Home offers a Recommended build next to plain
 *  ComfyUI. Both: the two. Always optional. */
export type NodesAt = 'off' | 'build' | 'home' | 'both'
export const NODES_AT: { value: NodesAt; label: string }[] = [
  { value: 'off', label: 'Off (today)' },
  { value: 'build', label: 'New build step' },
  { value: 'home', label: 'Home: Recommended build' },
  { value: 'both', label: 'Both' }
]
/** Where the first install ends, once the Home exists. Home: the Home, with
 *  a toast, as the prototype had it. Ready: the Home, with the install card
 *  saying ComfyUI is ready and an Open ComfyUI. ComfyUI: straight into the
 *  build, templates and all, as Desktop does today; the Home waits for the
 *  second launch. */
export type AfterInstall = 'home' | 'ready' | 'comfyui'
export const AFTER_INSTALLS: { value: AfterInstall; label: string }[] = [
  { value: 'home', label: 'Home, no message' },
  { value: 'ready', label: 'Home: ComfyUI is ready card' },
  { value: 'comfyui', label: 'Open ComfyUI (as today)' }
]

/** Where the Home draws the first install's card (Home first). Top: its
 *  own section under the greeting, the apps under it; when ComfyUI is
 *  ready the section says so. Builds: inside the Builds section, where it
 *  always sits, as the first build, large while it installs or waits to be
 *  opened and small once opened. One place for the build, never two. */
export type CardAt = 'top' | 'builds'
export const CARD_ATS: { value: CardAt; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'builds', label: 'In Builds' }
]

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
  onboarding: Onboarding
  after: AfterInstall
  card: CardAt
  os: SetupOs
  gpu: SetupGpu
  nodes: NodesAt
} {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      mode: v.mode === 'on' ? 'on' : 'off',
      machine: MACHINES.some((m) => m.value === v.machine) ? v.machine : 'ready',
      // Decided: the first screen uses Cards.
      cards: 'glow',
      scope: v.scope === 'next' ? 'next' : 'm1',
      onboarding: ONBOARDINGS.some((o) => o.value === v.onboarding) ? v.onboarding : 'install',
      after: AFTER_INSTALLS.some((a) => a.value === v.after) ? v.after : 'home',
      card: v.card === 'builds' ? 'builds' : 'top',
      os: SETUP_OSES.some((o) => o.value === v.os) ? v.os : 'mac',
      gpu: SETUP_GPUS.some((g) => g.value === v.gpu) ? v.gpu : 'nvidia',
      nodes: NODES_AT.some((n) => n.value === v.nodes) ? v.nodes : 'off'
    }
  } catch {
    return {
      mode: 'off',
      machine: 'ready',
      cards: 'glow',
      scope: 'm1',
      onboarding: 'install',
      after: 'home',
      card: 'top',
      os: 'mac',
      gpu: 'nvidia',
      nodes: 'off'
    }
  }
}

export const localSetup = reactive(load())

/** The first screen's card options side by side (SetupCanvas.vue), from
 *  UI Playground › Local setup or `?canvas=first`. */
export const canvas = ref(new URLSearchParams(location.search).get('canvas') === 'first')

// `?setup=first` links straight to the proposed flow, on first launch: the
// first release, where the install lands on Builds. Every other pick travels
// in the Playground's share link (shareLink.ts): `?share&m=4.5&step=first
// &setup=on&setup.scope=next&setup.onboarding=home-running&setup.after=ready`.
const linkFirst = new URLSearchParams(location.search).get('setup') === 'first'
if (linkFirst) {
  localSetup.mode = 'on'
  localSetup.scope = 'm1'
}

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
/** Home first applies only where the Home exists (the next iterations). */
export const homeFirst = computed(
  () => setupOn.value && localSetup.scope === 'next' && localSetup.onboarding !== 'install'
)
/** Home first › Home stays open: the first-run Home shows around the card. */
export const homeOpen = computed(() => homeFirst.value && localSetup.onboarding === 'home-open')
/** Home first › Install runs behind: Run on and Set up, then the Home with
 *  the install already going on its card; apps run on Comfy Cloud meanwhile. */
export const homeRunning = computed(
  () => homeFirst.value && localSetup.onboarding === 'home-running'
)
/** Home first › Run on only: Local lands on the Home with the install
 *  already running in Builds; the computer is detected, not shown. What Set
 *  up would have stopped on (no space, no supported hardware) stops the
 *  card instead, with its Change. */
export const homeDirect = computed(() => homeFirst.value && localSetup.onboarding === 'home-direct')

// The scope is a milestone: M1 is Builds · MVP, where All builds is the
// landing; the next iterations land on Milestone 2 (Explore apps), the Home
// that ships next, not on the furthest one.
const M1_MILESTONE = 2
const M2_MILESTONE = 4.5
function showScope(): void {
  const m = localSetup.scope === 'm1' ? M1_MILESTONE : M2_MILESTONE
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

export interface NodePack {
  id: string
  name: string
  author: string
  /** What it adds, in a line. */
  adds: string
  mb: number
  /** Picked for a new user: popular and tested on every system it lists. */
  recommended?: boolean
  /** The systems it is tested on; missing means all three. */
  os?: SetupOs[]
}

/** Node packs to offer (mock, from the registry's most installed). The
 *  recommended five are the ones a new user starts with; the real list
 *  comes from install data, tested per system before it ships. */
export const NODE_PACKS: NodePack[] = [
  {
    id: 'rgthree',
    name: 'rgthree-comfy',
    author: 'rgthree',
    adds: 'Groups, bypass, seeds and a cleaner graph',
    mb: 4,
    recommended: true
  },
  {
    id: 'kj',
    name: 'ComfyUI-KJNodes',
    author: 'kijai',
    adds: 'Masks, batches, resizing and everyday utilities',
    mb: 12,
    recommended: true
  },
  {
    id: 'vhs',
    name: 'ComfyUI-VideoHelperSuite',
    author: 'Kosinkadink',
    adds: 'Load and save video, frames and audio',
    mb: 9,
    recommended: true
  },
  {
    id: 'cnaux',
    name: 'comfyui_controlnet_aux',
    author: 'Fannovel16',
    adds: 'Depth, pose, line art and edge maps for ControlNet',
    mb: 38,
    recommended: true
  },
  {
    id: 'essentials',
    name: 'ComfyUI_essentials',
    author: 'cubiq',
    adds: 'Image, mask and text basics ComfyUI leaves out',
    mb: 6,
    recommended: true
  },
  {
    id: 'impact',
    name: 'ComfyUI-Impact-Pack',
    author: 'ltdrdata',
    adds: 'Face and detail fixes, detectors and segmenting',
    mb: 64
  },
  {
    id: 'ipadapter',
    name: 'ComfyUI_IPAdapter_plus',
    author: 'cubiq',
    adds: 'Use an image as a style or subject reference',
    mb: 3
  },
  {
    id: 'gguf',
    name: 'ComfyUI-GGUF',
    author: 'city96',
    adds: 'Run quantized models in less memory',
    mb: 2
  },
  {
    id: 'easyuse',
    name: 'ComfyUI-Easy-Use',
    author: 'yolain',
    adds: 'Simpler all-in-one loaders and samplers',
    mb: 21
  },
  {
    id: 'florence',
    name: 'ComfyUI-Florence2',
    author: 'kijai',
    adds: 'Caption, detect and ground images',
    mb: 5
  },
  {
    id: 'sage',
    name: 'ComfyUI-SageAttention',
    author: 'thu-ml',
    adds: 'Faster attention on NVIDIA cards',
    mb: 15,
    os: ['windows', 'linux']
  }
]
/** Whether a pack is tested on the computer the checks found. */
export const packFits = (p: NodePack): boolean => !p.os || p.os.includes(localSetup.os)
/** The recommended packs this computer can take. */
export const recommendedPacks = (): string[] =>
  NODE_PACKS.filter((p) => p.recommended && packFits(p)).map((p) => p.id)
/** Where custom nodes are offered (UI Playground › Start › Custom nodes). */
export const nodesInBuild = computed(
  () => setupOn.value && (localSetup.nodes === 'build' || localSetup.nodes === 'both')
)
export const nodesOnHome = computed(
  () => setupOn.value && (localSetup.nodes === 'home' || localSetup.nodes === 'both')
)

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
  takeover: false,
  /** Home first: the install runs behind the Home, on its card. Closing the
   *  install modal then only hides it. */
  background: false,
  /** Home first: Local was picked, so the Home shows the install card. */
  homeCard: false,
  /** After install › Ready: the card stays, saying ComfyUI is ready, until
   *  Open ComfyUI or Not now. */
  ready: false,
  /** The node packs this install adds, by id. Empty: plain ComfyUI. */
  packs: [] as string[]
})
export const pickedPacks = computed(() => NODE_PACKS.filter((p) => flow.packs.includes(p.id)))
export const packsMb = computed(() => pickedPacks.value.reduce((n, p) => n + p.mb, 0))
/** Home first, Local picked and not installed yet: the install waits (or
 *  runs) on the Home's card. */
export const installPending = computed(
  () => homeFirst.value && flow.homeCard && !instances.value.some((i) => i.kind === 'local')
)
/** The install card drawn inside the Builds section (UI Playground › Local
 *  setup › Install card): while the install waits or runs, and once ComfyUI
 *  is ready until it is opened. */
export const cardInBuilds = computed(
  () => (localSetup.card === 'builds' || homeDirect.value) && (installPending.value || flow.ready)
)
/** The install runs (or failed) behind the Home: the sidebar's Builds show it. */
export const installingBehind = computed(
  () => flow.background && (flow.running || flow.step === 'error')
)

/** The first local build's name, as Builds will list it: the Home card and
 *  the sidebar carry it before the build exists. */
export const BUILD_NAME = 'My Local 1'
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
// Picked node packs install after the environment, then a picked starter
// workflow adds its models as a last step, as today.
export const phases = computed<{ until: number; label: string }[]>(() => {
  const extra: string[] = []
  if (flow.packs.length)
    extra.push(`Install ${flow.packs.length} node pack${flow.packs.length === 1 ? '' : 's'}`)
  if (flow.picked && !flow.picked.credits) extra.push(`Download ${flow.picked.title} models`)
  if (!extra.length) return [...PHASES]
  const base = extra.length === 2 ? 0.7 : 0.8
  const rest = (100 - Math.round(100 * base)) / extra.length
  return [
    ...PHASES.map((p) => ({ ...p, until: Math.round(p.until * base) })),
    ...extra.map((label, i) => ({
      label,
      until: i === extra.length - 1 ? 100 : Math.round(100 * base + rest * (i + 1))
    }))
  ]
})
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
  // Builds lists the build just installed as the card said it: this
  // version, nothing to update.
  proto.installedVersion = DETECTED.version
  flow.open = false
  const picked = flow.picked
  const m1 = localSetup.scope === 'm1'
  flow.background = false
  flow.homeCard = false
  // M1 has no Home: the install lands on All builds, in M1's own shell.
  if (m1) {
    showScope()
    go('environments')
    return
  }
  showScope()
  // Where the first install ends (UI Playground › Local setup › After install).
  if (localSetup.after === 'comfyui') {
    go('overview')
    // The new build joins the list on the next tick.
    void nextTick(() => openComfyUI(picked?.title))
    return
  }
  go('overview')
  // Home: no toast, the page changes and the new build shows in the sidebar.
  if (localSetup.after === 'ready') {
    flow.homeCard = true
    flow.ready = true
  }
}

/** Opens the new local build, as Desktop opens ComfyUI today. */
export function openComfyUI(what?: string): void {
  flow.ready = false
  flow.homeCard = false
  const inst = instances.value.find((i) => i.kind === 'local')
  if (inst) hostActions.launch(inst, what)
  else toast('Opening ComfyUI')
}

/** After install › Ready › Not now: the card goes; the Home stays. */
export function dismissReady(): void {
  flow.ready = false
  flow.homeCard = false
}

/** Entry: the first launch, then every New Instance button. */
export function openSetup(): boolean {
  if (!setupOn.value) return false
  // Today's New Instance opens the install wizard directly.
  flow.step = marUser.local === 'none' ? 'first' : 'setup'
  flow.takeover = flow.step === 'first'
  flow.percent = 0
  flow.picked = null
  // A new build starts on the recommended packs, where they are offered.
  flow.packs = nodesInBuild.value && flow.step === 'setup' ? recommendedPacks() : []
  flow.movedDisk = false
  flow.confirmCancel = false
  flow.confirmLowDisk = false
  flow.logs = false
  flow.background = false
  flow.ready = false
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

/** Home first › Local: the Home, with the install waiting on its card: what
 *  was detected, Install, and Change for where it goes and on which
 *  hardware. Nothing installs until Install. */
export function landHomeLocal(): void {
  flow.open = false
  flow.takeover = false
  flow.picked = null
  // The Home offers the Recommended build first, where it is on.
  flow.packs = nodesOnHome.value ? recommendedPacks() : []
  flow.homeCard = true
  showScope()
  go('overview')
  flow.background = false
}

/** Home first › Cloud: the Home, nothing installs. */
export function landHomeCloud(): void {
  flow.takeover = false
  flow.homeCard = false
  showScope()
  go('overview')
  chooseCloud()
}

/** Home first › Install runs behind: Set up › Install lands on the Home
 *  with the install already running on its card. */
export function landHomeInstalling(): void {
  flow.homeCard = true
  showScope()
  go('overview')
  installInBackground()
}

export function installInBackground(): void {
  flow.open = false
  flow.takeover = false
  flow.background = true
  startInstall()
}

/** The Home card › View logs: today's install screen, over the Home. */
export function showInstall(): void {
  flow.logs = true
  flow.open = true
}

/** The Home card › Edit packs: the node packs, on their own sheet. */
export function packsFromHome(): void {
  flow.takeover = false
  flow.step = 'nodes'
  flow.open = true
}

/** The Home card › Change: Change setup, straight on its sheet. */
export function changeFromHome(): void {
  stop()
  flow.percent = 0
  flow.background = false
  flow.takeover = false
  flow.step = 'change'
  flow.open = true
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
  flow.background = false
  flow.confirmCancel = false
  flow.percent = 0
}

/** UI Playground › Start at Home: out of the onboarding, onto the Home. */
export function showHome(): void {
  stop()
  flow.open = false
  proto.activeTab = 'home'
  go('overview')
}

export function closeSetup(): void {
  // Closing while it installs is Return to Dashboard: it asks first.
  // Home first: the install carries on behind the Home.
  if (flow.background && (flow.running || flow.step === 'error')) flow.open = false
  else if (flow.running) flow.confirmCancel = true
  // Before the first install there is no Home yet: back to the first screen.
  else if (flow.takeover) flow.step = 'first'
  else flow.open = false
}

if (linkFirst) {
  showScope()
  setUser('first')
  openSetup()
}

/** UI Playground › Custom nodes: the pick, then the screen it shows on, since
 *  neither place is part of the first launch. New build (and Both): the
 *  step itself. Home: the first install's card, which needs the Home. */
export function showNodes(v: NodesAt): void {
  localSetup.nodes = v
  if (v === 'build' || v === 'both') showScreen('nodes')
  else if (v === 'home') {
    stop()
    localSetup.mode = 'on'
    localSetup.scope = 'next'
    if (localSetup.onboarding === 'install') localSetup.onboarding = 'home'
    marUser.local = 'none'
    landHomeLocal()
  }
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
  | 'nodes'
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
  { value: 'builds', label: 'Has builds' },
  { value: 'nodes', label: 'New build: custom nodes' }
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
  const later = s === 'builds' || s === 'nodes'
  marUser.local = later ? 'one' : 'none'
  // The custom nodes step is a new build's: it shows with the tweak on.
  if (s === 'nodes' && !nodesInBuild.value) localSetup.nodes = 'both'
  Object.assign(flow, {
    open: true,
    takeover: !later,
    packs: s === 'nodes' ? recommendedPacks() : [],
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
    builds: 'setup',
    nodes: 'nodes'
  }
  flow.step = step[s]
  if (s === 'error') flow.percent = 46
  if (s === 'installing' || s === 'cancel') {
    flow.percent = 58
    flow.running = true
    timer = setInterval(tick, 180)
  }
}
