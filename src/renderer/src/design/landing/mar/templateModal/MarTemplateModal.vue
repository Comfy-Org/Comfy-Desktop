<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { onClickOutside, useElementSize } from '@vueuse/core'
import {
  ArrowDownToLine,
  AudioLines,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronDown,
  Coins,
  Cpu,
  CreditCard,
  Film,
  HardDrive,
  Image as ImageIcon,
  ImageOff,
  KeyRound,
  Link2,
  Plug,
  Puzzle,
  RefreshCw,
  Star,
  Timer,
  TriangleAlert,
  Type,
  UserRound,
  WifiOff,
  Wrench,
  X
} from 'lucide-vue-next'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import LocationIcon from '../../ui/LocationIcon.vue'
import { PORTAL_TO } from '../../ui/portal'
import { hostActions, instanceById, proto, toast } from '../../useProto'
import { can } from '../../milestones'
import { browserSignIn, SIGN_IN_COPY } from '../signIn/browserSignIn'
import MarRunCreditsSheet from '../MarRunCreditsSheet.vue'
import { runBlock } from '../runCredits'
import { opensTemplate, openAction, openNote, openWithExample } from '../templateOpen/openTemplate'
import { openPrepTab } from '../templateOpen/prepTabs'
import { installThenOpen } from '../templateOpen/installThenOpen'
import { isDownloaded, markDownloaded } from '../templateOpen/installed'
import { isFavorite, toggleFavorite } from '../favorites'
import { workflows } from '../pages/workflowsStore'
import { thumb } from '../../mock'
import { ComfyModel } from '../icons/comfyIcons'
import {
  CASE_STATE,
  MACHINE,
  SAVED_MISSING_MODELS,
  aboutFor,
  caseBuild,
  caseNeeds,
  fmtGb,
  hasPack,
  infoFor,
  managerHint,
  minComfyFor,
  missingPacks,
  packsFor,
  mediaFor,
  needsFor,
  reasonFor,
  tplById,
  totalGb,
  versionShort,
  type NeedKind,
  type Target
} from './templateData'
import { bestTarget, targetsFor } from './runReadiness'
import { graphFor } from './graphSpec'
import { examplesFor } from './tplExamples'
import { inputsFor, type InputKind } from './tplInputs'
import { firstResultFor, fmtDuration } from './firstResult'
import TplGraph from './TplGraph.vue'
import Tooltip from '../../ui/Tooltip.vue'
import ZoomControl from '../assets/ZoomControl.vue'
import MarSeg from '../pages/MarSeg.vue'
import TplDownloadActions from '../downloads/TplDownloadActions.vue'
import { downloadFor, startDownload } from '../downloads/templateDownloads'
import { START_COPY } from '../build/comfyStart'
// The asset view's frame, panel, sections and buttons (.mad-*): the modal
// wears them, so the two read as one view. Imported for its styles.
import '../assets/AssetDetail.vue'
import './templateModal.css'

/**
 * Mar's template modal, in the asset view's format: the output (or its
 * graph) on the left, the details on a panel a step lighter on the right.
 * The panel says where it opens (the best build, why in one line, the
 * others behind one quiet picker) and what it needs. At the bottom, one
 * line and one action: what happens, or what's in the way and the way
 * through it; More beside it.
 * Templates and saved workflows alike: a saved workflow wears the same
 * view, opens on the build it was saved in, and says what that build
 * still needs before it runs.
 */
const saved = computed(() => {
  const d = proto.detail
  if (d?.kind !== 'workflow') return undefined
  return workflows.items.find((w) => w.id === d.id || w.name === d.id)
})
const savedIn = computed(() => (saved.value?.envId ? instanceById(saved.value.envId) : undefined))
const template = computed(() => {
  if (proto.detail?.kind === 'template') return tplById(proto.detail.id)
  const w = saved.value
  if (!w) return undefined
  const base = startedFrom(w.thumbId)
  return base ? { ...base, title: w.name } : undefined
})
/** The example a saved workflow started from: its picture's id names it
 *  (template~workflow), else the default example. */
function startedFrom(thumbId: string): ReturnType<typeof tplById> {
  return tplById(thumbId.split('~')[0] ?? '') ?? tplById('image_z_image_turbo')
}
const basedOn = computed(() => (saved.value ? startedFrom(saved.value.thumbId)?.title : undefined))
const open = computed({
  get: () => Boolean(template.value),
  set: (v) => {
    if (!v) proto.detail = null
  }
})

const media = computed(() => {
  if (!template.value) return undefined
  const own = saved.value?.thumbId ? thumb(saved.value.thumbId) : undefined
  return own ? { hero: own, output: own } : mediaFor(template.value)
})
const info = computed(() => (template.value ? infoFor(template.value) : undefined))
const needs = computed(() => (template.value ? needsFor(template.value) : []))
const total = computed(() => (template.value ? totalGb(template.value) : 0))
const graph = computed(() =>
  template.value && media.value ? graphFor(template.value, media.value) : undefined
)
const examples = computed(() =>
  template.value && media.value && !saved.value ? examplesFor(template.value, media.value) : []
)
const exampleAt = ref(0)
const example = computed(() => examples.value[exampleAt.value])
const stagePic = computed(() => example.value?.pic ?? media.value?.hero ?? '')
function pickExample(i: number): void {
  if (i === exampleAt.value) return
  exampleAt.value = i
  zoom.value = 100
}
function measureClip(e: Event): void {
  const v = e.target as HTMLVideoElement
  if (v.videoWidth && v.videoHeight) ratio.value = v.videoWidth / v.videoHeight
  natural.value = v.videoWidth
}
const inputs = computed(() => (template.value && !saved.value ? inputsFor(template.value) : []))
const INPUT_ICONS: Record<InputKind, typeof Coins> = {
  image: ImageIcon,
  text: Type,
  video: Film,
  audio: AudioLines
}

const targets = computed<Target[]>(() => {
  const t = template.value
  if (!t) return []
  const gone =
    saved.value &&
    SAVED_MISSING_MODELS.has(saved.value.name) &&
    !(savedIn.value && isDownloaded(t.id, savedIn.value.id))
  return targetsFor(t, {
    modelsGoneOn: gone ? savedIn.value?.id : undefined,
    prefer: saved.value ? null : undefined
  })
})
const best = computed(() => bestTarget(targets.value))
const reason = computed(() =>
  best.value && template.value ? reasonFor(best.value, targets.value, template.value) : ''
)

const selectedId = ref<string>()
/** The picture's own shape, so it fits the stage like an asset does. */
const ratio = ref(16 / 9)
const natural = ref(0)
function measure(e: Event): void {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) ratio.value = img.naturalWidth / img.naturalHeight
  natural.value = img.naturalWidth
}
/** The fitted picture's width over the file's, so the zoom reads in real
 *  size as on an asset. */
const mediaEl = ref<HTMLElement>()
const { width: mediaW } = useElementSize(mediaEl)
const fitStyle = computed(() => ({
  '--r': ratio.value,
  '--natural-w': natural.value ? `${natural.value}px` : undefined
}))
const picFit = computed(() => (natural.value && mediaW.value ? mediaW.value / natural.value : 1))
/** What the section and the action show: the pick, or, when nothing can
 *  be picked (offline, Cloud only), the first build and why it can't. */
const shown = computed(() => selected.value ?? targets.value[0])
/** Why the default is the default, in one short line: the first sentence
 *  of the reason. Only while the default is the pick. */
const fit = computed(() =>
  !saved.value &&
  !bgDownload.value &&
  reason.value &&
  shown.value?.inst.id === best.value?.inst.id &&
  shown.value?.state !== 'running' &&
  shown.value?.state !== 'ready'
    ? reason.value.split(/(?<=\.) /)[0]!
    : ''
)
/** The one line over the action: what happens, or what's in the way. */
const line = computed(() => {
  const s = shown.value
  if (!s) return ''
  if (s.state === 'blocked' || s.state === 'platform')
    return `${s.status}. Pick another build to open it.`
  if (s.state === 'download' && keptGb.value)
    return `${fmtGb(keptGb.value)} of ${fmtGb(total.value)} is already here. Downloading picks up where it stopped.`
  if (exampleOn.value && template.value && opensTemplate(s)) return openNote(s, template.value)
  // The plain cases need no line: the button says it.
  return s.state === 'running' || s.state === 'ready' ? '' : s.note
})
const exampleOn = computed(() => can.value.onboarding && !saved.value)
const primaryLabel = computed(() => {
  const s = shown.value
  if (!s) return 'Open'
  return (exampleOn.value ? openAction(s) : s.action) || 'Open'
})
const cloudTarget = computed(() =>
  targets.value.find((x) => x.inst.kind === 'cloud' && !x.inst.deployment)
)
const cloudOffer = computed(() => {
  const s = selected.value
  const c = cloudTarget.value
  if (!exampleOn.value || !s || !c || c.disabled || c.state === 'blocked') return false
  return s.inst.kind === 'local' && (s.state === 'download' || Boolean(s.fetch))
})
/** The cost's colour: a warning only for what may fail; a download stays
 *  quiet, even on a build short of memory. */
const tone = (x: Target): string =>
  (x.state === 'memory' && x.cost !== 'May fail') || x.state === 'gated' ? 'download' : x.state
const buildMenu = ref(false)
const buildBox = ref<HTMLElement>()
onClickOutside(buildBox, () => (buildMenu.value = false))
function pickBuild(x: Target): void {
  if (x.disabled) return
  selectedId.value = x.inst.id
  buildMenu.value = false
}
const favorited = computed(() =>
  saved.value
    ? Boolean(saved.value.fav)
    : template.value
      ? isFavorite(template.value.id, 'template')
      : false
)
const selected = computed(() => targets.value.find((x) => x.inst.id === selectedId.value))
const tplDownload = computed(() =>
  proto.detail?.kind === 'template' && template.value ? downloadFor(template.value.id) : undefined
)
const bgDownload = computed(() =>
  tplDownload.value?.status === 'cancelled' ? undefined : tplDownload.value
)
const downloadBusy = computed(() => Boolean(bgDownload.value && bgDownload.value.status !== 'done'))
const keptGb = computed(() =>
  tplDownload.value?.status === 'cancelled' ? tplDownload.value.doneGb : 0
)
const DOWNLOAD_NEEDS: Record<string, string> = {
  paused: 'Paused',
  failed: 'Download failed',
  done: 'Installed'
}
const view = ref<'result' | 'graph'>('result')
const phase = ref<'idle' | 'busy'>('idle')
const progress = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

watch(
  () => proto.detail,
  () => {
    const home = targets.value.find((x) => x.inst.id === savedIn.value?.id && !x.disabled)
    const t = template.value
    const kase =
      t && !saved.value ? targets.value.find((x) => x.inst.id === caseBuild(t)) : undefined
    selectedId.value = (kase ?? home ?? best.value ?? targets.value.find((x) => !x.disabled))?.inst
      .id
    view.value = 'result'
    exampleAt.value = 0
    buildMenu.value = false
    ratio.value = 16 / 9
    stop()
  },
  { immediate: true }
)
onBeforeUnmount(stop)

function stop(): void {
  clearInterval(timer)
  phase.value = 'idle'
  progress.value = 0
}

/** Per model, what the chosen build means for it. */
const modelState = computed<'here' | 'get' | 'cloud' | undefined>(() => {
  const s = selected.value?.state
  if (s === 'running' || s === 'ready' || s === 'repair' || s === 'media') return 'here'
  if (s === 'download' || s === 'disk' || s === 'gated') return 'get'
  if (s === 'credits' || s === 'plan') return 'cloud'
  if (s === 'offline') return selected.value!.inst.kind === 'cloud' ? undefined : 'get'
  if (s === 'update' || s === 'nodes' || s === 'new') return selected.value!.fetch ? 'get' : 'here'
  if (s === 'cloud') return 'cloud'
  if (s === 'memory') return selected.value!.cost === 'May fail' ? 'here' : 'get'
  return undefined
})
const memoryOk = computed(() => {
  const v = info.value?.vramGb
  if (!v) return true
  return selected.value?.inst.kind === 'cloud' || v <= MACHINE.memGb
})

/** The steps the one button runs, in order, each with its share of the bar. */
const steps = computed<{ label: string; share: number }[]>(() => {
  const s = selected.value
  const t = template.value
  if (!s || !t) return []
  const out: { label: string; share: number }[] = []
  if (s.state === 'new') out.push({ label: 'Installing ComfyUI', share: 2 })
  if (s.state === 'repair') out.push({ label: `Repairing ${s.inst.name}`, share: 2 })
  if (s.state === 'gated') out.push({ label: 'Waiting for the licence', share: 1 })
  if (versionShort(t, s.inst)) out.push({ label: `Updating ${s.inst.name}`, share: 2 })
  if (s.fetch) out.push({ label: 'download', share: 3 })
  return out
})
const busyLabel = computed(() => {
  const s = selected.value
  if (!s) return ''
  const list = steps.value
  if (list.length && s.state !== 'download') {
    const all = list.reduce((n, x) => n + x.share, 0)
    let at = 0
    for (const x of list) {
      const end = at + x.share / all
      if (progress.value < end || x === list.at(-1)) {
        if (x.label !== 'download') return x.label
        const part = Math.min(1, (progress.value - at) / (end - at))
        return `Downloading ${fmtGb(total.value * part)} of ${fmtGb(total.value)}`
      }
      at = end
    }
  }
  if (s.state === 'download')
    return `Downloading ${fmtGb(total.value * progress.value)} of ${fmtGb(total.value)}`
  if (s.state === 'update') return `Updating ${s.inst.name}`
  if (s.inst.kind === 'cloud') return `Opening ${s.inst.name}`
  return START_COPY.title
})

const creditsSheet = ref(false)
const afterCredits = ref<'confirm' | 'cloud'>('confirm')
function confirm(): void {
  const s = selected.value
  const t = template.value
  if (!s || !t || s.disabled || phase.value === 'busy' || bgDownload.value) return
  if (s.state === 'login') {
    hostActions.signIn(() => void nextTick(confirm))
    return
  }
  if (s.state === 'new') {
    if (exampleOn.value) installThenOpen(t)
    else hostActions.newInstance()
    return
  }
  if (s.inst.kind === 'cloud' && runBlock.value) {
    afterCredits.value = 'confirm'
    creditsSheet.value = true
    return
  }
  if (s.state === 'credits' || s.state === 'plan') {
    toast(
      s.state === 'credits' ? 'Add credits opens in your browser' : 'Plans open in your browser'
    )
    return
  }
  if (s.state === 'download' && s.inst.kind === 'local' && !saved.value) {
    startDownload(t, s.inst)
    if (exampleOn.value) openPrepTab(t, s.inst)
    return
  }
  if (s.inst.kind === 'local' && !steps.value.length && s.state !== 'download') {
    if (exampleOn.value && opensTemplate(s)) openWithExample(t, s.inst)
    else hostActions.launch(s.inst, t.title)
    return
  }
  phase.value = 'busy'
  const shares = steps.value.reduce((n, x) => n + x.share, 0)
  const ms =
    s.state !== 'download' && shares
      ? 600 * shares
      : s.state === 'download'
        ? 2600
        : s.state === 'running'
          ? 700
          : 1400
  const t0 = Date.now()
  timer = setInterval(() => {
    progress.value = Math.min(1, (Date.now() - t0) / ms)
    if (progress.value < 1) return
    stop()
    if (saved.value && s.state === 'download') markDownloaded(t.id, s.inst.id)
    if (exampleOn.value && opensTemplate(s)) openWithExample(t, s.inst)
    else hostActions.launch(s.inst, t.title)
  }, 40)
}

function tryCloud(): void {
  const c = cloudTarget.value
  const t = template.value
  if (!c || !t) return
  if (c.state === 'login') {
    hostActions.signIn(tryCloud)
    return
  }
  if (c.state === 'credits' || c.state === 'plan') {
    toast(
      c.state === 'credits' ? 'Add credits opens in your browser' : 'Plans open in your browser'
    )
    return
  }
  if (runBlock.value) {
    afterCredits.value = 'cloud'
    creditsSheet.value = true
    return
  }
  stop()
  openWithExample(t, c.inst)
}
function creditsResolved(): void {
  if (afterCredits.value === 'cloud') tryCloud()
  else confirm()
}

function favorite(): void {
  if (saved.value) workflows.star(saved.value.id)
  else if (template.value) toggleFavorite(template.value.id, 'template')
}
function share(): void {
  void navigator.clipboard
    ?.writeText(`https://comfy.org/templates/${template.value?.id}`)
    .catch(() => {})
  toast('Link copied')
}

const content = ref<{ $el: HTMLElement }>()
function focusPicker(e: Event): void {
  e.preventDefault()
  void nextTick(() => {
    const el = content.value?.$el as HTMLElement | undefined
    ;(el?.querySelector<HTMLElement>('[data-tpl-primary]:not(:disabled)') ?? el)?.focus({
      preventScroll: true,
      // Enter runs it; no ring until the keyboard moves.
      focusVisible: false
    } as FocusOptions)
  })
}
/** Escape closes an open menu first, then the modal. */
function onEscape(e: KeyboardEvent): void {
  if (zoomCtl.value?.open) {
    e.preventDefault()
    zoomCtl.value.open = false
    return
  }
  if (!buildMenu.value) return
  e.preventDefault()
  buildMenu.value = false
}
/** Enter launches from nowhere in particular; on a control it keeps its
 *  own meaning (on the primary, it is the primary). */
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Enter' || e.isComposing) return
  const el = e.target as HTMLElement
  if (!el.closest('button, a, input, textarea, [role="tab"]')) {
    e.preventDefault()
    confirm()
  }
}

/** The needs, in one line, for the build picked: what it has, or what
 *  it downloads first. */
/** What it needs, closed: how much on the left, where it stands on the right. */
const needsLine = computed(() => {
  const n = needs.value.length
  if (!n)
    return template.value?.runs === 'cloud' ? 'Partner API on Comfy Cloud' : 'Nothing to download'
  const p = packs.value.length
  const extra = p ? ` · ${p} node ${p === 1 ? 'pack' : 'packs'}` : ''
  return `${n} ${n === 1 ? 'model' : 'models'} · ${fmtGb(total.value)}${extra}`
})
const packs = computed(() => (template.value ? packsFor(template.value) : []))
const minComfy = computed(() => (template.value ? minComfyFor(template.value) : ''))
/** Per pack or version line, what the chosen build means for it. */
const packMark = (pack: string): 'here' | 'get' | 'warn' =>
  !selected.value || hasPack(selected.value.inst, pack)
    ? 'here'
    : selected.value.inst.kind === 'cloud'
      ? 'warn'
      : 'get'
const PACK_TITLE = {
  here: 'Installed',
  get: 'Install it in ComfyUI with Manager',
  warn: 'Not on Cloud yet'
}
const missingCount = computed(() => packs.value.filter((p) => packMark(p) === 'get').length)
const caseRows = computed(() => (template.value ? caseNeeds(template.value, shown.value) : []))
const caseState = computed(() => {
  const s = shown.value
  if (!s || !can.value.onboarding) return undefined
  if (s.state === 'blocked' && packs.value.some((p) => packMark(p) === 'warn'))
    return { label: 'Not on Cloud yet', tone: 'warn' }
  return s.state === 'memory' && s.cost !== 'May fail' ? undefined : CASE_STATE[s.state]
})
const NEED_ICONS: Record<NeedKind, typeof Coins> = {
  disk: HardDrive,
  gpu: Cpu,
  licence: KeyRound,
  input: ImageOff,
  account: UserRound,
  credits: Coins,
  plan: CreditCard,
  repair: Wrench,
  network: WifiOff
}
const comfyMark = computed<'here' | 'get'>(() =>
  selected.value && template.value && versionShort(template.value, selected.value.inst)
    ? 'get'
    : 'here'
)
const needsState = computed(() =>
  caseState.value
    ? caseState.value.label
    : comfyMark.value === 'get'
      ? 'Updates first'
      : missingCount.value
        ? 'Install in ComfyUI'
        : !needs.value.length
          ? ''
          : modelState.value === 'cloud'
            ? 'Ready on Cloud'
            : modelState.value === 'here'
              ? 'Installed'
              : 'Downloads first'
)

const needsTone = computed(() =>
  caseState.value
    ? caseState.value.tone
    : needsState.value === 'Updates first' || needsState.value === 'Install in ComfyUI'
      ? 'get'
      : modelState.value
)

const needsPill = computed(() => {
  const d = bgDownload.value
  if (!d) return { label: needsState.value, tone: needsTone.value }
  if (d.status === 'downloading') return { label: '', tone: 'get' }
  const tone = d.status === 'done' ? 'here' : d.status === 'paused' ? 'get' : 'warn'
  return { label: DOWNLOAD_NEEDS[d.status] ?? '', tone }
})

const firstResult = computed(() =>
  template.value ? firstResultFor(template.value, shown.value, bgDownload.value) : undefined
)
const firstResultParts = computed(() =>
  (firstResult.value?.parts ?? []).map((p) => `${p.label} ${fmtDuration(p.secs)}`).join(' · ')
)

const aboutEl = ref<HTMLElement>()
const aboutOpen = ref(false)
const aboutLong = ref(false)
watch(
  [() => proto.detail, aboutEl],
  () => {
    aboutOpen.value = false
    void nextTick(() => {
      const el = aboutEl.value
      aboutLong.value = Boolean(el && el.scrollHeight > el.clientHeight + 1)
    })
  },
  { immediate: true }
)

// The graph's zoom: a percentage of the fitted size, read in real size.
const zoom = ref(100)
const graphFit = ref(1)
const zoomCtl = ref<InstanceType<typeof ZoomControl>>()
watch(view, () => (zoom.value = 100))

const VIEWS: { value: 'result' | 'graph'; label: string }[] = [
  { value: 'result', label: 'Result' },
  { value: 'graph', label: 'Graph' }
]
// The graph takes the whole stage so zoomed in it runs to the edges; it
// fits inside the room the picture has (under the bar, over the zoom).
const GRAPH_PAD = { t: 64, r: 32, b: 72, l: 32 }
const full = computed(() => can.value.onboarding)
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal :to="PORTAL_TO" defer>
      <DialogOverlay class="proto-ui mad-scrim mar-tpl-dim" />
      <DialogContent
        v-if="template && info && media"
        ref="content"
        class="proto-ui mad mar-tpl"
        :class="full && 'is-full'"
        :data-busy="phase === 'busy' || undefined"
        @open-auto-focus="focusPicker"
        @escape-key-down="onEscape"
        @keydown="onKey"
      >
        <section class="mad-stage" @pointerdown.self="open = false">
          <header class="mad-bar">
            <MarSeg v-model="view" :options="VIEWS" label="Preview" class="mar-tpl-views" />
            <span v-if="view === 'result' && example?.madeWith" class="mar-tpl-made-with"
              >Made with {{ example.madeWith }}</span
            >
          </header>
          <div v-if="view === 'result'" class="mad-view" :class="examples.length && 'has-strip'">
            <div class="mad-fit" :class="natural && 'is-natural'" :style="fitStyle">
              <div ref="mediaEl" class="mad-media" :style="{ scale: zoom / 100 }">
                <video
                  v-if="example?.clip"
                  :key="example.id"
                  :src="example.clip"
                  :poster="example.pic"
                  autoplay
                  muted
                  loop
                  playsinline
                  @loadedmetadata="measureClip"
                />
                <img
                  v-else
                  :key="stagePic"
                  :src="stagePic"
                  alt=""
                  draggable="false"
                  @load="measure"
                />
                <template v-if="media.quadrants && exampleAt === 0">
                  <span
                    v-for="(q, i) in media.quadrants"
                    :key="q"
                    class="mar-tpl-quad"
                    :data-q="i"
                    >{{ q }}</span
                  >
                </template>
              </div>
            </div>
          </div>
          <!-- The graph takes the picture's place, fitted to the same area. -->
          <div v-else-if="graph" class="mar-tpl-gview">
            <TplGraph v-model:zoom="zoom" v-model:fit="graphFit" :spec="graph" :pad="GRAPH_PAD" />
          </div>
          <!-- Zoom, where the asset view keeps it, bottom right, for the
               picture and the graph alike. -->
          <footer class="mad-foot">
            <nav
              v-if="view === 'result' && examples.length"
              class="mad-strip mar-tpl-examples"
              aria-label="Example results"
            >
              <button
                v-for="(x, i) in examples"
                :key="x.id"
                type="button"
                class="mad-thumb"
                :aria-current="i === exampleAt"
                :aria-label="`Example ${i + 1} of ${examples.length}`"
                :title="x.madeWith ? `Made with ${x.madeWith}` : `Example ${i + 1}`"
                data-tpl-example
                @click="pickExample(i)"
              >
                <img :src="x.pic" alt="" loading="lazy" draggable="false" />
                <Film v-if="x.clip" :size="11" class="mar-tpl-example-clip" />
              </button>
            </nav>
            <span v-else />
            <ZoomControl
              ref="zoomCtl"
              v-model="zoom"
              :fit="view === 'graph' ? graphFit : picFit"
              keys
            />
          </footer>
        </section>

        <aside class="mad-side" aria-label="Workflow details">
          <div class="mad-body">
            <header class="mad-head">
              <div class="mad-head-text">
                <DialogTitle class="mad-name" :class="full && 'is-clamped'">{{
                  template.title
                }}</DialogTitle>
                <DialogDescription v-if="saved" class="mar-tpl-by">
                  <LocationIcon :kind="saved.source === 'cloud' ? 'cloud' : 'local'" :size="12" />{{
                    savedIn?.name ?? (saved.source === 'cloud' ? 'Comfy Cloud' : 'This computer')
                  }}<i />Edited {{ saved.modified }}
                </DialogDescription>
                <DialogDescription v-else class="mar-tpl-by">
                  <span class="mar-tpl-author"><ComfyCLogo :size="10" /></span>ComfyUI<i />{{
                    info.useCase
                  }}
                </DialogDescription>
              </div>
              <!-- Favorite and the link, out in the open at the top right. -->
              <Tooltip :content="favorited ? 'Remove from favorites' : 'Add to favorites'">
                <button
                  type="button"
                  class="mad-icon mar-tpl-head-btn"
                  :class="favorited && 'is-on'"
                  data-tpl-like
                  :aria-label="favorited ? 'Remove from favorites' : 'Add to favorites'"
                  :aria-pressed="favorited"
                  @click="favorite"
                >
                  <Star
                    :key="String(favorited)"
                    :size="15"
                    :fill="favorited ? 'currentColor' : 'none'"
                    :class="favorited && 'mar-tpl-fav'"
                  />
                </button>
              </Tooltip>
              <Tooltip v-if="!saved" content="Copy link">
                <button
                  type="button"
                  class="mad-icon mar-tpl-head-btn"
                  aria-label="Copy link"
                  @click="share"
                >
                  <Link2 :size="15" />
                </button>
              </Tooltip>
              <DialogClose
                v-if="full"
                class="mad-icon mad-head-close"
                aria-label="Close"
                title="Close"
                ><X :size="16"
              /></DialogClose>
            </header>

            <!-- What it does, short: the first paragraph. -->
            <section v-if="!saved" class="mad-sec">
              <!-- Four lines at most; More opens the rest in place. -->
              <div class="mar-tpl-about">
                <p ref="aboutEl" :class="!aboutOpen && 'is-clamped'">
                  {{ aboutFor(template)[0] }}
                </p>
                <button
                  v-if="aboutLong"
                  type="button"
                  class="mar-tpl-more"
                  :aria-expanded="aboutOpen"
                  @click="aboutOpen = !aboutOpen"
                >
                  {{ aboutOpen ? 'Less' : 'More' }}
                </button>
              </div>
            </section>

            <!-- Open in, with What it needs right under it (it follows the pick): the build it opens on, as one filled row that is
                 the picker (the other builds open under it), then why in
                 one line. What blocks it is one line and one action at the
                 bottom, in place of the primary. -->
            <section v-if="inputs.length" class="mad-sec" data-tpl-inputs>
              <h3 class="mad-label">What you give it</h3>
              <ul class="mar-tpl-inputs">
                <li v-for="x in inputs" :key="x.label">
                  <component :is="INPUT_ICONS[x.kind]" :size="14" />
                  <span class="mar-tpl-file is-ui">{{ x.label }}</span>
                  <span v-if="x.optional" class="mar-tpl-size">Optional</span>
                </li>
              </ul>
            </section>

            <section class="mad-sec">
              <h3 class="mad-label">Open in</h3>
              <div v-if="shown" ref="buildBox" class="mad-pick">
                <button
                  type="button"
                  class="mar-tpl-on"
                  :data-s="shown.state"
                  :aria-label="`Open in ${shown.inst.name}. Change build`"
                  aria-haspopup="menu"
                  :aria-expanded="buildMenu"
                  :disabled="phase === 'busy' || downloadBusy || targets.length < 2"
                  @click="buildMenu = !buildMenu"
                >
                  <span class="mar-tpl-glyph">
                    <LocationIcon
                      :kind="shown.inst.kind === 'cloud' ? 'cloud' : 'local'"
                      :size="18"
                    />
                    <i v-if="shown.inst.state === 'running' && !shown.disabled" />
                  </span>
                  <span class="mar-tpl-row-text">
                    <span class="mar-tpl-row-name">{{ shown.inst.name }}</span>
                    <span class="mar-tpl-row-status">{{ shown.status }}</span>
                  </span>
                  <span v-if="shown.cost" class="mar-tpl-cost" :data-s="tone(shown)">{{
                    shown.cost
                  }}</span>
                  <ChevronDown v-if="targets.length > 1" :size="14" class="mar-tpl-chev" />
                </button>
                <div v-if="buildMenu" class="mad-menu is-down mar-tpl-builds" role="menu">
                  <button
                    v-for="x in targets"
                    :key="x.inst.id"
                    type="button"
                    role="menuitemradio"
                    :aria-checked="x.inst.id === selectedId"
                    :class="x.inst.id === selectedId && 'is-on'"
                    :disabled="x.disabled"
                    :data-s="x.state"
                    @click="pickBuild(x)"
                  >
                    <LocationIcon :kind="x.inst.kind === 'cloud' ? 'cloud' : 'local'" :size="15" />
                    <span class="mar-tpl-row-text">
                      <span class="mar-tpl-row-name">{{ x.inst.name }}</span>
                      <span class="mar-tpl-row-status">{{ x.status }}</span>
                    </span>
                    <span class="mar-tpl-cost" :data-s="tone(x)">{{ x.cost }}</span>
                  </button>
                </div>
              </div>
              <p v-if="fit" class="mar-tpl-fit"><BadgeCheck :size="13" />{{ fit }}</p>
            </section>

            <!-- What it needs, on the build picked above: one box like Open
                 in's, its line folding the files open inside it. -->
            <section class="mad-sec">
              <h3 class="mad-label">What it needs</h3>
              <details
                class="mar-tpl-needs-box"
                @toggle="
                  ($event.target as HTMLDetailsElement).open &&
                  ($event.target as HTMLElement).scrollIntoView({ block: 'nearest' })
                "
              >
                <summary>
                  <span class="mar-tpl-total">{{ needsLine }}</span>
                  <span v-if="needsPill.label" class="mar-tpl-state" :data-m="needsPill.tone">{{
                    needsPill.label
                  }}</span>
                  <ChevronDown :size="14" class="mar-tpl-fold" />
                </summary>
                <ul class="mar-tpl-needs">
                  <li v-for="m in needs" :key="m.name">
                    <ComfyModel :size="14" />
                    <span class="mar-tpl-file">{{ m.name.replace('.safetensors', '') }}</span>
                    <span class="mar-tpl-size">{{ m.size }}</span>
                    <span
                      class="mar-tpl-mark"
                      :data-m="modelState"
                      :title="
                        modelState === 'here'
                          ? 'Installed'
                          : modelState === 'get'
                            ? 'Downloads first'
                            : modelState === 'cloud'
                              ? 'Ready on Cloud'
                              : ''
                      "
                    >
                      <Check v-if="modelState === 'here' || modelState === 'cloud'" :size="12" />
                      <ArrowDownToLine v-else-if="modelState === 'get'" :size="12" />
                    </span>
                  </li>
                  <li v-for="p in packs" :key="p">
                    <Puzzle :size="14" />
                    <span class="mar-tpl-file">{{ p }}</span>
                    <span class="mar-tpl-size">{{
                      packMark(p) === 'get' ? 'Missing' : 'Node pack'
                    }}</span>
                    <span
                      class="mar-tpl-mark"
                      :data-m="packMark(p)"
                      :title="PACK_TITLE[packMark(p)]"
                    >
                      <Check v-if="packMark(p) === 'here'" :size="12" />
                      <TriangleAlert v-else :size="11" />
                    </span>
                  </li>
                  <li v-if="minComfy">
                    <RefreshCw :size="14" />
                    <span class="mar-tpl-file">ComfyUI {{ minComfy }} or newer</span>
                    <span class="mar-tpl-size">{{
                      comfyMark === 'get' ? `has ${selected?.inst.version}` : ''
                    }}</span>
                    <span
                      class="mar-tpl-mark"
                      :data-m="comfyMark"
                      :title="comfyMark === 'here' ? 'Up to date' : 'Updates first'"
                    >
                      <Check v-if="comfyMark === 'here'" :size="12" />
                      <ArrowDownToLine v-else :size="12" />
                    </span>
                  </li>
                  <li v-for="r in caseRows" :key="r.kind" :data-need="r.kind">
                    <component :is="NEED_ICONS[r.kind]" :size="14" />
                    <span class="mar-tpl-file is-ui">{{ r.label }}</span>
                    <span class="mar-tpl-size">{{ r.size }}</span>
                    <span class="mar-tpl-mark" :data-m="r.mark" :title="r.title">
                      <Check v-if="r.mark === 'here'" :size="12" />
                      <TriangleAlert v-else-if="r.mark === 'warn'" :size="11" />
                      <ArrowDownToLine v-else :size="12" />
                    </span>
                  </li>
                  <li v-if="template.runs === 'cloud'">
                    <Plug :size="14" />
                    <span class="mar-tpl-file">Partner model API</span>
                    <span class="mar-tpl-size">Comfy Cloud</span>
                    <span class="mar-tpl-mark" />
                  </li>
                  <li v-if="info.vramGb">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect
                        x="2.5"
                        y="4"
                        width="11"
                        height="8"
                        rx="1.5"
                        stroke="currentColor"
                        stroke-width="1.3"
                      />
                      <path
                        d="M5 4V2.5M8 4V2.5M11 4V2.5M5 13.5V12M8 13.5V12M11 13.5V12"
                        stroke="currentColor"
                        stroke-width="1.3"
                        stroke-linecap="round"
                      />
                    </svg>
                    <span class="mar-tpl-file is-ui">GPU memory</span>
                    <span class="mar-tpl-size">{{ info.vramGb }} GB</span>
                    <span class="mar-tpl-mark" :data-m="memoryOk ? 'here' : 'warn'">
                      <Check v-if="memoryOk" :size="12" />
                      <TriangleAlert v-else :size="11" />
                    </span>
                  </li>
                </ul>
              </details>
              <p v-if="missingCount" class="mar-tpl-fit" data-tpl-packs>
                <Puzzle :size="13" />{{ missingPacks(missingCount) }} ·
                {{ managerHint(missingCount) }}
              </p>
              <div v-if="firstResult" class="mar-tpl-eta" data-tpl-eta>
                <Timer :size="14" class="mar-tpl-eta-icon" />
                <span class="mar-tpl-eta-label">First result in</span>
                <span class="mar-tpl-eta-time">{{ firstResult.label }}</span>
                <span class="mar-tpl-eta-parts">{{ firstResultParts }}</span>
              </div>
            </section>

            <section v-if="saved" class="mad-sec">
              <h3 class="mad-label">Details</h3>
              <dl class="mad-rows">
                <div>
                  <dt>Saved in</dt>
                  <dd>{{ savedIn?.name ?? 'This computer' }}</dd>
                </div>
                <div>
                  <dt>Edited</dt>
                  <dd>{{ saved.modified }}</dd>
                </div>
                <div v-if="saved.project">
                  <dt>Project</dt>
                  <dd>{{ saved.project }}</dd>
                </div>
                <div v-if="basedOn">
                  <dt>Started from</dt>
                  <dd :title="basedOn">{{ basedOn }}</dd>
                </div>
              </dl>
            </section>
            <section v-else class="mad-sec">
              <h3 class="mad-label">Details</h3>
              <dl class="mad-rows">
                <div>
                  <dt>Author</dt>
                  <dd>ComfyUI</dd>
                </div>
                <div v-if="info.model">
                  <dt>Model</dt>
                  <dd>{{ info.model }}</dd>
                </div>
                <div>
                  <dt>Uses</dt>
                  <dd>{{ info.uses }}</dd>
                </div>
                <div>
                  <dt>License</dt>
                  <dd :title="info.license">{{ info.license }}</dd>
                </div>
                <!-- Only when the catalog has one: no row pointing nowhere. -->
                <div v-if="info.tutorial">
                  <dt>Tutorial</dt>
                  <dd>
                    <a
                      class="mar-tpl-tutorial"
                      :href="info.tutorial"
                      target="_blank"
                      rel="noreferrer"
                      ><BookOpen :size="13" />docs.comfy.org</a
                    >
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <!-- At the bottom: what happens, then the one action. -->
          <footer v-if="bgDownload" class="mad-actions">
            <TplDownloadActions :download="bgDownload" />
            <button
              v-if="cloudOffer && bgDownload.status !== 'done'"
              type="button"
              class="mad-btn"
              data-tpl-cloud
              :disabled="browserSignIn.pending"
              @click="tryCloud"
            >
              <LocationIcon kind="cloud" :size="15" />
              <span>{{
                browserSignIn.pending && cloudTarget?.state === 'login'
                  ? SIGN_IN_COPY.waiting
                  : 'Try it now on Cloud'
              }}</span>
            </button>
          </footer>
          <footer v-else class="mad-actions">
            <p v-if="line" class="mar-tpl-note">{{ line }}</p>
            <button
              v-if="cloudOffer"
              type="button"
              class="mad-btn"
              data-tpl-cloud
              :disabled="browserSignIn.pending"
              @click="tryCloud"
            >
              <LocationIcon kind="cloud" :size="15" />
              <span>{{
                browserSignIn.pending && cloudTarget?.state === 'login'
                  ? SIGN_IN_COPY.waiting
                  : 'Try it now on Cloud'
              }}</span>
            </button>
            <button
              type="button"
              class="mad-btn is-primary mar-tpl-go"
              data-tpl-primary
              :disabled="!selected || selected.disabled"
              :data-s="shown?.state"
              :style="{ '--p': progress }"
              @click="confirm"
            >
              <span>{{
                phase === 'busy'
                  ? busyLabel
                  : browserSignIn.pending && shown?.state === 'login'
                    ? SIGN_IN_COPY.waiting
                    : primaryLabel
              }}</span>
              <kbd v-if="phase === 'idle' && selected && !selected.disabled">↵</kbd>
            </button>
          </footer>
        </aside>

        <DialogClose v-if="!full" class="mad-x" aria-label="Close"><X :size="18" /></DialogClose>
        <MarRunCreditsSheet v-model:open="creditsSheet" @resolved="creditsResolved" />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
