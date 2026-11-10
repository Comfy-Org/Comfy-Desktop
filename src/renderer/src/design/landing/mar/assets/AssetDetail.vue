<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import {
  AppWindow,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileOutput,
  FolderOpen,
  ImagePlus,
  Info,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
  Workflow,
  X
} from 'lucide-vue-next'
import { onClickOutside, useResizeObserver } from '@vueuse/core'
import ZoomControl from './ZoomControl.vue'
import CompareSplit from './CompareSplit.vue'
import { thumb } from '../../mock'
import { toast } from '../../useProto'
import { assets as desktopAssets, type MarAsset } from '../pages/assetsStore'
import { graphLibrary } from '../graph/comfyLook'
import { createdAt, factsFor } from './assetFacts'
import { saveFile } from './saveFile'
import AssetCover from './AssetCover.vue'
import GenerationInfo from './GenerationInfo.vue'
import { addTag, removeTag, tagsOf } from './assetTags'
import { LABELS, labelColor, labelOf, setLabel } from './assetLabels'

/**
 * One asset, large (Better Asset Management PRD). One view for both
 * surfaces: ComfyUI opens it from Inspect asset with tags you can edit
 * (Phase 1), Desktop from its gallery with tags read-only (Phase 2). The
 * picture fills the window, the details sit on the right: the file, its
 * tags, what's on record, and what could be read from the run, labelled
 * as inferred, never as fact. Arrows and the filmstrip step through the
 * list as it's filtered; Escape or Assets closes and hands focus back to
 * the tile. It opens as a framed window over the app, the same from the
 * canvas and from Assets, Details open; zoom and the file's size sit along
 * the bottom, Download leads the details (Alex Tov's media-assets proto).
 * From that proto too: a zoom slider in the zoom's menu, the file's
 * details as rows, a color label, and a More menu beside Download.
 */
const {
  asset,
  list,
  build,
  editable = false,
  tab = false,
  saveable = false,
  onWorkflow,
  onTab
} = defineProps<{
  asset: MarAsset
  list: MarAsset[]
  /** The build whose catalog this is. */
  build: string
  /** ComfyUI: tags are edited here. */
  editable?: boolean
  /** ComfyUI in Production: the asset fills a tab beside the workflows,
   *  the tab's X closes it, no filmstrip or zoom. */
  tab?: boolean
  /** A canvas result, not saved yet: it can be saved to Assets. */
  saveable?: boolean
  /** Desktop's Assets: Open workflow goes to ComfyUI with the asset
   *  selected (bound as @workflow); else a toast stands in. */
  onWorkflow?: (a: MarAsset) => void
  /** ComfyUI with workflow tabs: the quick look can move to its own tab
   *  (bound as @tab), the full view with its details. */
  onTab?: (a: MarAsset) => void
}>()
const emit = defineEmits<{ close: []; go: [asset: MarAsset]; save: [] }>()

const facts = computed(() => factsFor(asset))
const tags = computed(() => tagsOf(asset))
/** Adding a tag: "+ Add tag" turns into a chip-sized field in the same
 *  row, suggesting the tags already in use as you type. Enter adds the
 *  highlighted one (or creates the name), Escape cancels, Backspace on an
 *  empty field takes the last tag off. */
const draft = ref('')
const adding = ref(false)
const hi = ref(0)
const field = ref<HTMLInputElement>()
const known = computed(() => [...new Set(list.flatMap((a) => tagsOf(a)))].sort())
const query = computed(() => draft.value.trim().replace(/^#/, '').toLowerCase())
const offers = computed(() => {
  const q = query.value
  const found = known.value
    .filter((t) => !tags.value.includes(t) && (!q || t.includes(q)))
    .slice(0, 6)
    .map((t) => ({ tag: t, create: false }))
  return q && !known.value.includes(q) ? [...found, { tag: q, create: true }] : found
})
watch(query, () => (hi.value = 0))
watch(() => asset.id, closeAdd)
async function openAdd(): Promise<void> {
  adding.value = true
  hi.value = 0
  await nextTick()
  field.value?.focus()
}
function closeAdd(): void {
  adding.value = false
  draft.value = ''
}
function add(tag = offers.value[hi.value]?.tag): void {
  if (tag) addTag(asset, tag)
  draft.value = ''
  hi.value = 0
}
function tagKey(e: KeyboardEvent): void {
  const n = offers.value.length
  if (e.key === 'ArrowDown' && n) hi.value = (hi.value + 1) % n
  else if (e.key === 'ArrowUp' && n) hi.value = (hi.value - 1 + n) % n
  else if (e.key === 'Enter') add()
  else if (e.key === 'Escape') closeAdd()
  else if (e.key === 'Backspace' && !draft.value && tags.value.length)
    removeTag(asset, tags.value[tags.value.length - 1]!)
  else return
  e.preventDefault()
}
/** A src that is a clip, not a picture (a canvas result's video). */
const isClip = (src?: string): boolean => !!src && /^data:video|\.(mp4|webm|mov)(\?|#|$)/i.test(src)
const pic = computed(() => picOf(asset))
// From the words the card shows ("Yesterday"), so card and details agree.
const added = computed(() =>
  createdAt(asset).toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
)
const at = computed(() => list.findIndex((a) => a.id === asset.id))
function picOf(a: MarAsset): string | undefined {
  if (a.src && !isClip(a.src)) return a.src
  return a.thumbId ? thumb(a.thumbId) : undefined
}

/** Zoom: `zoom` scales the fitted picture (100 = fit, back to fit on
 *  every asset). The control reads in real size: the fitted picture's
 *  width over the file's, so a large file fits at 63%. */
const zoom = ref(100)
const media = ref<HTMLElement>()
const fit = ref(1)
function measure(): void {
  const w = facts.value.width ?? (media.value?.querySelector('img')?.naturalWidth || 0)
  if (media.value && w) fit.value = media.value.clientWidth / w
}
const zoomCtl = ref<InstanceType<typeof ZoomControl>>()
/** Compare: only for a picture made from another (an app's output). */
const comparing = ref(false)
const compareModel = computed({
  get: () => (asset.before && !clip.value ? comparing.value : undefined),
  set: (v) => (comparing.value = Boolean(v))
})
watch(
  () => asset.id,
  () => (comparing.value = false)
)
/** The details panel folds away for the picture alone. */
const side = ref(true)
// The fit changes with the stage: the window, or Details folding.
useResizeObserver(media, measure)

// The filmstrip keeps the current asset in view, and fades at an edge
// where more thumbnails sit past it, so none runs into the zoom.
const strip = ref<HTMLElement>()
const edges = ref({ start: false, end: false })
function measureStrip(): void {
  const el = strip.value
  if (!el) return
  edges.value = {
    start: el.scrollLeft > 1,
    end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1
  }
}
watch(
  () => asset.id,
  async () => {
    zoom.value = 100
    await nextTick()
    strip.value
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' })
    requestAnimationFrame(measureStrip)
  },
  { immediate: true }
)
const prev = computed(() => list[at.value - 1])
const next = computed(() => list[at.value + 1])

// The run's data comes from the build after the file: a beat of loading.
const loading = ref(true)
let timer = 0
watch(
  () => asset.id,
  () => {
    loading.value = true
    clearTimeout(timer)
    timer = window.setTimeout(() => (loading.value = false), 420)
  },
  { immediate: true }
)

const dims = computed(() =>
  facts.value.width ? `${facts.value.width} × ${facts.value.height}` : undefined
)
const KIND: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  '3d': '3D model',
  text: 'Text',
  other: 'File'
}
/** The file as rows: what it is, its size on screen and on disk, when it
 *  came to be, and who made or brought it in. */
const details = computed(() =>
  (
    [
      ['Type', `${KIND[asset.type] ?? 'File'} · ${facts.value.format}`],
      ['Dimensions', dims.value],
      ['Length', facts.value.duration],
      ['Size', asset.size],
      [facts.value.imported ? 'Date imported' : 'Date created', added.value],
      ['Run time', facts.value.seconds ? `${facts.value.seconds.toFixed(1)}s` : undefined],
      ['Uploaded by', facts.value.uploadedBy ?? build]
    ] as [string, string | undefined][]
  ).filter((r): r is [string, string] => !!r[1])
)

// One color label per file, picked from a menu; picking it again takes it off.
const label = computed(() => labelOf(asset.id))
const labelName = computed(() => LABELS.find((l) => l.value === label.value)?.label)
const labelMenu = ref(false)
const labelBox = ref<HTMLElement>()
onClickOutside(labelBox, () => (labelMenu.value = false))
function pickLabel(l?: (typeof LABELS)[number]['value']): void {
  const v = l ?? label.value
  if (v) setLabel([asset.id], v)
  labelMenu.value = false
}

// More, beside Download: what the file has beyond the labeled actions,
// the same as its card's right-click.
const moreMenu = ref(false)
const moreBox = ref<HTMLElement>()
onClickOutside(moreBox, () => (moreMenu.value = false))
/** Insert into workflow opens its two ways in place, under the row. */
const insertOpen = ref(false)
watch(moreMenu, (on) => on || (insertOpen.value = false))
function copyText(text: string, what: string): void {
  navigator.clipboard?.writeText(text).catch(() => {})
  toast(`Copied ${what}`)
  moreMenu.value = false
}
/** Show in Finder: only a file on this computer, never a Comfy Cloud one. */
const onDisk = computed(() => asset.source !== 'cloud')
function reveal(): void {
  toast(`Revealed ${asset.name}`)
  moreMenu.value = false
}
/** A loader node for its type, as Insert into workflow › on the card. */
const LOADER: Partial<Record<MarAsset['type'], string>> = {
  image: 'Load Image',
  video: 'Load Video',
  audio: 'Load Audio',
  '3d': 'Load 3D'
}
const loader = computed(() => LOADER[asset.type] ?? 'Load File')
function insert(into: 'new' | 'selected'): void {
  toast(
    into === 'new'
      ? `Added ${asset.name} as a ${loader.value} node`
      : `${asset.name} is in the selected node`
  )
  moreMenu.value = false
}
function openWorkflow(): void {
  moreMenu.value = false
  if (onWorkflow) onWorkflow(asset)
  else toast(editable ? `Opened ${asset.name} as a workflow` : `Opening the workflow in ${build}`)
}
/** Export workflow: the run's workflow as a file, saved by the browser. */
function exportWorkflow(): void {
  moreMenu.value = false
  const f = facts.value
  const json = f.json ?? JSON.stringify({ workflow: f.workflowName }, null, 2)
  saveFile(
    URL.createObjectURL(new Blob([json], { type: 'application/json' })),
    f.workflowName ?? `${asset.name.replace(/\.[^.]+$/, '')}.json`
  )
}
/** Delete: off the list it came from, with Undo; the view steps on to
 *  the next file, or closes on the last one. */
function remove(): void {
  moreMenu.value = false
  const to = next.value ?? prev.value
  const me = toRaw(asset)
  const store = [desktopAssets, graphLibrary].find((s) => s.items.some((i) => toRaw(i) === me))
  if (store) store.remove([asset.id])
  else toast(`Deleted “${asset.name}”`)
  if (to) emit('go', to)
  else emit('close')
}

/** Video and audio play here. A video without a file of its own plays one
 *  of the proto's clips, picked by name like its cover; a sound has none,
 *  so its player runs on the clock, over the length on record. */
const CLIPS = Object.values(
  import.meta.glob<string>(['./*.mp4', './examples/gv-*.mp4'], { eager: true, import: 'default' })
)
const nameHash = (s: string): number => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
const isVideo = computed(() => asset.type === 'video')
const isAudio = computed(() => asset.type === 'audio')
const clip = computed(() =>
  !isVideo.value
    ? undefined
    : isClip(asset.src)
      ? asset.src
      : CLIPS[nameHash(asset.name) % CLIPS.length]
)
const secondsOf = (d?: string): number =>
  (d ?? '0:00').split(':').reduce((n, p) => n * 60 + Number(p), 0)
const vid = ref<HTMLVideoElement>()
const playing = ref(false)
const cur = ref(0)
const dur = ref(0)
const muted = ref(false)
const clock = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
/** Bars of the sound's waveform, the same for the same file. */
const WAVE = computed(() => {
  const h = nameHash(asset.name)
  return Array.from({ length: 56 }, (_, i) => {
    const env = 0.35 + 0.65 * Math.sin(((i + 0.5) / 56) * Math.PI)
    const n = (((h + i * 2654435761) >>> 0) % 1000) / 1000
    return Math.round((0.18 + 0.82 * env * (0.45 + 0.55 * n)) * 100)
  })
})
const played = computed(() => (dur.value ? cur.value / dur.value : 0))
function toggle(): void {
  if (isVideo.value && vid.value) {
    if (vid.value.paused) void vid.value.play().catch(() => {})
    else vid.value.pause()
  } else if (isAudio.value) {
    if (!playing.value && cur.value >= dur.value) cur.value = 0
    playing.value = !playing.value
  }
}
function seek(e: Event): void {
  const t = Number((e.target as HTMLInputElement).value)
  cur.value = t
  if (vid.value) vid.value.currentTime = t
}
function toggleMute(): void {
  muted.value = !muted.value
  if (vid.value) vid.value.muted = muted.value
}
let raf = 0
let last = 0
function tick(now: number): void {
  if (!playing.value) return
  if (isAudio.value) {
    cur.value = Math.min(dur.value, cur.value + (now - last) / 1000)
    if (cur.value >= dur.value) playing.value = false
  } else if (vid.value) cur.value = vid.value.currentTime
  last = now
  raf = requestAnimationFrame(tick)
}
watch(playing, (on) => {
  cancelAnimationFrame(raf)
  if (on) {
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }
})
watch(
  () => asset.id,
  () => {
    playing.value = false
    cur.value = 0
    dur.value = isAudio.value ? secondsOf(facts.value.duration) : 0
  },
  { immediate: true }
)

const root = ref<HTMLElement>()
const addBtn = ref<HTMLButtonElement>()
const opener = document.activeElement as HTMLElement | null
const menuOpen = (): boolean => moreMenu.value || labelMenu.value || Boolean(zoomCtl.value?.open)
/** Escape closes what's open, innermost first, and hands focus back to
 *  the button that opened it. */
function closeMenus(): boolean {
  if (insertOpen.value) {
    insertOpen.value = false
    return true
  }
  const box = moreMenu.value ? moreBox : labelMenu.value ? labelBox : null
  if (zoomCtl.value?.open) {
    zoomCtl.value.open = false
    zoomCtl.value.$el.querySelector('[aria-haspopup]')?.focus()
    return true
  }
  if (!box) return false
  moreMenu.value = labelMenu.value = false
  box.value?.querySelector<HTMLElement>('[aria-haspopup]')?.focus()
  return true
}
const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || t.matches('input, textarea, select'))
function key(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    // A menu or the tag field closes first; the view only once none is open.
    if (adding.value) {
      closeAdd()
      void nextTick(() => addBtn.value?.focus())
    } else if (!closeMenus()) {
      if (tab) return
      emit('close')
    }
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    // Never while a menu or the tag field is open, or in a field or slider.
    if (adding.value || menuOpen() || typing(e.target)) return
    const to = e.key === 'ArrowLeft' ? prev.value : next.value
    if (!to) return
    emit('go', to)
  } else if (e.key === ' ' && (isVideo.value || isAudio.value)) {
    if (adding.value || menuOpen() || typing(e.target)) return
    if (e.target instanceof HTMLButtonElement) return
    toggle()
  } else return
  e.preventDefault()
  e.stopImmediatePropagation()
}
onMounted(async () => {
  window.addEventListener('keydown', key, true)
  await nextTick()
  if (!tab) root.value?.focus()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', key, true)
  clearTimeout(timer)
  cancelAnimationFrame(raf)
  if (!tab) opener?.focus?.()
})
</script>

<template>
  <Teleport to="body" :disabled="tab">
    <div :class="tab ? 'mad-host' : 'proto-ui mad-scrim'" @pointerdown.self="emit('close')">
      <button v-if="!tab" type="button" class="mad-x" aria-label="Close" @click="emit('close')">
        <X :size="18" />
      </button>
      <div
        ref="root"
        class="proto-ui mad"
        :class="[!side && 'no-side', tab && 'is-tab']"
        :role="tab ? 'region' : 'dialog'"
        :aria-modal="tab ? undefined : true"
        :aria-label="asset.name"
        tabindex="-1"
      >
        <section class="mad-stage" @pointerdown.self="!tab && emit('close')">
          <header class="mad-bar"></header>
          <!-- The picture is clipped to its own area: zoomed in, it never
               runs under the bar or the filmstrip. -->
          <div class="mad-view">
            <!-- The frame holds the player's bar outside the zoom, so it keeps
                 its size while the picture scales. -->
            <div class="mad-fit" :style="{ '--r': facts.ratio }">
              <div ref="media" class="mad-media" :style="{ scale: zoom / 100 }">
                <video
                  v-if="clip"
                  ref="vid"
                  :key="asset.id"
                  :src="clip"
                  :poster="pic"
                  :muted="muted"
                  playsinline
                  preload="metadata"
                  @click="toggle"
                  @loadedmetadata="dur = vid?.duration || 0"
                  @play="playing = true"
                  @pause="playing = false"
                  @ended="playing = false"
                  @timeupdate="cur = vid?.currentTime ?? 0"
                />
                <img v-else-if="pic" :key="asset.id" :src="pic" alt="" @load="measure" />
                <CompareSplit v-if="comparing && asset.before && !clip" :before="asset.before" />
                <AssetCover v-else :name="asset.name" :type="asset.type" />
                <span v-if="asset.type === '3d'" class="mad-play"><Box :size="12" />3D</span>
              </div>
              <!-- The player: play, the time along a track (a sound's waveform),
                   and the sound. -->
              <div
                v-if="clip || isAudio"
                class="mad-player"
                :class="[playing && 'is-playing', isAudio && 'is-audio']"
                role="group"
                :aria-label="isAudio ? 'Audio player' : 'Video player'"
              >
                <button
                  type="button"
                  class="mad-player-btn"
                  :aria-label="playing ? 'Pause' : 'Play'"
                  :title="playing ? 'Pause' : 'Play'"
                  @click="toggle"
                >
                  <Pause v-if="playing" :size="15" /><Play v-else :size="15" />
                </button>
                <div class="mad-track" :style="{ '--p': played }">
                  <span v-if="isAudio" class="mad-wave" aria-hidden="true"
                    ><i
                      v-for="(h, i) in WAVE"
                      :key="i"
                      :class="(i + 0.5) / WAVE.length <= played && 'is-on'"
                      :style="{ height: `${h}%` }"
                  /></span>
                  <span v-else class="mad-rail" aria-hidden="true" />
                  <input
                    class="mad-seek"
                    type="range"
                    min="0"
                    :max="dur || 0"
                    step="0.01"
                    :value="cur"
                    aria-label="Seek"
                    :aria-valuetext="`${clock(cur)} of ${clock(dur)}`"
                    @input="seek"
                  />
                </div>
                <span class="mad-time">{{ clock(cur) }} / {{ clock(dur) }}</span>
                <button
                  v-if="clip"
                  type="button"
                  class="mad-player-btn"
                  :aria-label="muted ? 'Unmute' : 'Mute'"
                  :title="muted ? 'Unmute' : 'Mute'"
                  @click="toggleMute"
                >
                  <VolumeX v-if="muted" :size="15" /><Volume2 v-else :size="15" />
                </button>
              </div>
            </div>
          </div>
          <footer v-if="!tab" class="mad-foot">
            <nav
              ref="strip"
              class="mad-strip"
              :class="{ 'is-fade-start': edges.start, 'is-fade-end': edges.end }"
              aria-label="Assets"
              @scroll.passive="measureStrip"
            >
              <button
                v-for="a in list"
                :key="a.id"
                type="button"
                class="mad-thumb"
                :aria-current="a.id === asset.id"
                :aria-label="a.name"
                :title="a.name"
                @click="emit('go', a)"
              >
                <img v-if="picOf(a)" :src="picOf(a)" alt="" loading="lazy" />
                <AssetCover v-else :name="a.name" :type="a.type" />
              </button>
            </nav>
            <!-- Zoom: the real-size percentage, as on ComfyUI's canvas. -->
            <ZoomControl
              ref="zoomCtl"
              v-model="zoom"
              v-model:compare="compareModel"
              :fit="fit"
              keys
            />
          </footer>
        </section>

        <aside v-if="side" class="mad-side" aria-label="Asset details">
          <div class="mad-body">
            <header class="mad-head">
              <div class="mad-head-text">
                <h2 class="mad-name">{{ asset.name }}</h2>
              </div>
            </header>

            <section class="mad-sec">
              <h3 class="mad-label">Asset details</h3>
              <dl class="mad-rows">
                <div v-for="[k, v] in details" :key="k">
                  <dt>{{ k }}</dt>
                  <dd :title="v">{{ v }}</dd>
                </div>
              </dl>
            </section>

            <section class="mad-sec">
              <h3 class="mad-label">Label</h3>
              <div ref="labelBox" class="mad-pick">
                <button
                  type="button"
                  class="mad-select"
                  aria-haspopup="menu"
                  :aria-expanded="labelMenu"
                  @click="labelMenu = !labelMenu"
                >
                  <i
                    class="mad-dot"
                    :class="!label && 'is-none'"
                    :style="label && { background: labelColor(label) }"
                    aria-hidden="true"
                  /><span>{{ labelName ?? 'No label' }}</span
                  ><ChevronDown :size="13" />
                </button>
                <div v-if="labelMenu" class="mad-menu is-down is-wide" role="menu">
                  <button
                    v-for="l in LABELS"
                    :key="l.value"
                    type="button"
                    role="menuitemradio"
                    :aria-checked="label === l.value"
                    @click="pickLabel(l.value)"
                  >
                    <i class="mad-dot" :style="{ background: l.color }" aria-hidden="true" />{{
                      l.label
                    }}<Check v-if="label === l.value" :size="14" class="mad-menu-check" />
                  </button>
                  <button v-if="label" type="button" role="menuitem" @click="pickLabel()">
                    <i class="mad-dot is-none" aria-hidden="true" />No label
                  </button>
                </div>
              </div>
            </section>

            <section class="mad-sec">
              <h3 class="mad-label">
                Tags
                <span
                  v-if="!editable"
                  class="mad-tip"
                  tabindex="0"
                  role="note"
                  aria-label="Tags are edited in ComfyUI."
                  ><Info :size="12" /><span class="mad-tip-body is-short" aria-hidden="true"
                    >Tags are edited in ComfyUI.</span
                  ></span
                >
              </h3>
              <div class="mad-tags">
                <span class="mad-tag is-system" title="System tag, set by ComfyUI">{{
                  facts.imported ? 'input' : 'output'
                }}</span>
                <span v-for="t in tags" :key="t" class="mad-tag" :title="t"
                  ><span class="mad-tag-t">{{ t }}</span
                  ><button
                    v-if="editable"
                    type="button"
                    class="mad-tag-x"
                    :aria-label="`Remove ${t}`"
                    @click="removeTag(asset, t)"
                  >
                    <X :size="11" /></button
                ></span>
                <template v-if="editable">
                  <button
                    v-if="!adding"
                    ref="addBtn"
                    type="button"
                    class="mad-tag-add"
                    @click="openAdd"
                  >
                    <Plus :size="12" />Add tag
                  </button>
                  <div v-else class="mad-tag-pick">
                    <input
                      ref="field"
                      v-model="draft"
                      class="mad-tag-field"
                      placeholder="Tag name"
                      aria-label="Add a tag"
                      role="combobox"
                      aria-autocomplete="list"
                      :aria-expanded="offers.length > 0"
                      @keydown="tagKey"
                      @blur="closeAdd"
                    />
                    <div v-if="offers.length" class="mad-menu is-down is-wide" role="listbox">
                      <button
                        v-for="(o, i) in offers"
                        :key="o.tag + o.create"
                        type="button"
                        role="option"
                        :aria-selected="i === hi"
                        :class="i === hi && 'is-hi'"
                        @mousedown.prevent="add(o.tag)"
                        @mouseenter="hi = i"
                      >
                        <template v-if="o.create"><Plus :size="13" />Create "{{ o.tag }}"</template
                        ><template v-else>{{ o.tag }}</template>
                      </button>
                    </div>
                  </div>
                </template>
              </div>
            </section>

            <section class="mad-sec">
              <h3 class="mad-label">
                Generation details
                <span
                  class="mad-tip"
                  tabindex="0"
                  role="note"
                  aria-label="Inferred from the run’s data. A listed value may not have contributed to this output."
                  ><Info :size="12" /><span class="mad-tip-body" aria-hidden="true"
                    >Inferred from the run’s data. A listed value may not have contributed to this
                    output.</span
                  ></span
                >
              </h3>
              <GenerationInfo :facts="facts" :loading="loading" />
            </section>
          </div>
          <!-- At the bottom, labeled: only the actions this file has. Download
               leads; More sits at the right of Open workflow (of Download
               when there is no workflow). -->
          <footer class="mad-actions">
            <button
              v-if="facts.workflow === 'available'"
              type="button"
              class="mad-btn is-wf"
              :title="editable ? 'Open as workflow in new tab' : `Open the workflow in ${build}`"
              @click="openWorkflow"
            >
              <Workflow :size="14" /><span>{{
                editable ? 'Open as workflow' : 'Open workflow'
              }}</span>
            </button>
            <button v-if="onTab && !tab" type="button" class="mad-btn" @click="onTab(asset)">
              <AppWindow :size="14" /><span>Open in new tab</span>
            </button>
            <button v-if="saveable" type="button" class="mad-btn" @click="emit('save')">
              <Plus :size="14" /><span>Save to Assets</span>
            </button>
            <button
              type="button"
              class="mad-btn is-primary"
              @click="saveFile(picOf(asset), asset.name)"
            >
              <Download :size="14" /><span>Download</span>
            </button>
            <div ref="moreBox" class="mad-pick">
              <button
                type="button"
                class="mad-btn is-more"
                aria-label="More"
                title="More"
                aria-haspopup="menu"
                :aria-expanded="moreMenu"
                @click="moreMenu = !moreMenu"
              >
                <MoreHorizontal :size="16" />
              </button>
              <div v-if="moreMenu" class="mad-menu is-up is-end is-more" role="menu">
                <button v-if="onDisk" type="button" role="menuitem" @click="reveal">
                  <FolderOpen :size="14" />Show in Finder
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  :aria-expanded="insertOpen"
                  @click="insertOpen = !insertOpen"
                >
                  <Plus :size="14" />Insert into workflow<ChevronRight
                    :size="14"
                    class="mad-menu-chev"
                    :class="insertOpen && 'is-open'"
                  />
                </button>
                <div v-if="insertOpen" class="mad-menu-sub" role="menu">
                  <button type="button" role="menuitem" @click="insert('new')">
                    <Plus :size="14" />As a new {{ loader }} node
                  </button>
                  <button type="button" role="menuitem" @click="insert('selected')">
                    <ImagePlus :size="14" />Into the selected node
                  </button>
                </div>
                <template v-if="facts.workflow === 'available'">
                  <button type="button" role="menuitem" @click="openWorkflow">
                    <Workflow :size="14" />Open as workflow in new tab
                  </button>
                  <button type="button" role="menuitem" @click="exportWorkflow">
                    <FileOutput :size="14" />Export workflow
                  </button>
                </template>
                <button type="button" role="menuitem" @click="copyText(asset.name, 'file name')">
                  <Copy :size="14" />Copy file name
                </button>
                <button
                  v-if="facts.prompt"
                  type="button"
                  role="menuitem"
                  @click="copyText(facts.prompt, 'prompt')"
                >
                  <Copy :size="14" />Copy prompt
                </button>
                <span class="mad-menu-gap" role="separator" />
                <button type="button" role="menuitem" class="is-danger" @click="remove">
                  <Trash2 :size="14" />Delete
                </button>
              </div>
            </div>
          </footer>
        </aside>
      </div>
    </div>
  </Teleport>
</template>

<style>
/* A framed window over the app, blurred behind so the app reads as
 * still there; its close outside the frame. Steps go through the
 * filmstrip and the keyboard arrows. */
.mad-scrim {
  position: fixed;
  inset: 0;
  z-index: 60;
  /* Dim and quiet, so the picture in the modal is the only color. */
  background: rgb(0 0 0 / 0.62);
  -webkit-backdrop-filter: blur(20px) saturate(0.45);
  backdrop-filter: blur(20px) saturate(0.45);
  animation: mad-in 0.18s ease-out;
}
.mad-host {
  display: contents;
}
.mad {
  position: absolute;
  /* About 14% of the window around it, so the app shows behind. */
  inset: 13vh 14vw;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(320px, 28vw, 380px);
  /* Details are a card inside the frame, set apart by its fill, not by
   * lines. */
  gap: 8px;
  padding: 8px;
  overflow: hidden;
  border-radius: 20px;
  background: var(--color-content-background);
  box-shadow:
    0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 7%, transparent),
    0 30px 80px -20px rgb(0 0 0 / 0.6);
  color: var(--color-base-foreground);
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .mad-x {
  /* Just outside the frame's top-right corner. */
  position: absolute;
  top: 13vh;
  right: calc(14vw - 48px);
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.1);
  color: #fff;
}
:root .proto-ui.proto-ui.proto-ui .mad-x:hover {
  background: rgb(255 255 255 / 0.18);
}
.mad.no-side {
  grid-template-columns: minmax(0, 1fr);
}
/* In a tab: it fills the canvas area, under ComfyUI's top bar. */
.mad.is-tab {
  position: absolute;
  inset: 0;
  border-radius: 0;
  box-shadow: none;
  z-index: 3;
  background: var(--color-content-background);
  backdrop-filter: none;
  animation: none;
}
.mad.is-tab .mad-stage {
  padding: 56px 56px 32px;
}
@keyframes mad-in {
  from {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mad {
    animation: none;
  }
}
.mad-stage {
  position: relative;
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.mad.is-tab .mad-view {
  bottom: 16px;
}
.mad-view {
  position: absolute;
  inset: 64px 32px 92px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  /* The picture fits this area, not the window. */
  container-type: size;
}
.mad-bar {
  position: absolute;
  top: 18px;
  right: 24px;
  left: 32px;
  display: flex;
  align-items: center;
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mad-back {
  display: inline-flex;
  height: 30px;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui .mad-back:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
.mad-file {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mad-fit {
  position: relative;
  width: min(100%, calc(100cqh * var(--r)));
  min-width: 0;
  flex: 0 1 auto;
  aspect-ratio: var(--r);
}
.mad-media {
  position: relative;
  width: 100%;
  height: 100%;
  transition: scale 0.16s ease-out;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-secondary-background);
}
.mad-media img,
.mad-media video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mad-media video {
  cursor: pointer;
}
/* The player: a dark pill over the bottom of the frame, like the system's
 * own, gone while a video plays until the pointer comes back. */
.mad-player {
  position: absolute;
  right: 12px;
  bottom: 12px;
  left: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 8px 0 4px;
  border-radius: 12px;
  background: rgb(0 0 0 / 0.55);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  color: #fff;
  transition: opacity 0.18s ease;
}
.mad-player.is-playing:not(.is-audio) {
  opacity: 0;
}
.mad-fit:hover .mad-player,
.mad-player:focus-within {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .mad-player-btn {
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 8px;
  background: transparent;
  color: #fff;
}
:root .proto-ui.proto-ui.proto-ui .mad-player-btn:hover {
  background: rgb(255 255 255 / 0.14);
}
.mad-player-btn svg {
  fill: currentColor;
}
.mad-player-btn svg[class*='volume'] {
  fill: none;
}
.mad-track {
  position: relative;
  display: flex;
  min-width: 0;
  height: 28px;
  flex: 1;
  align-items: center;
}
.mad-rail {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    #fff calc(var(--p) * 100%),
    rgb(255 255 255 / 0.28) calc(var(--p) * 100%)
  );
}
.mad-wave {
  display: flex;
  width: 100%;
  height: 24px;
  align-items: center;
  gap: 2px;
}
.mad-wave i {
  min-width: 1px;
  flex: 1;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.32);
}
.mad-wave i.is-on {
  background: #fff;
}
/* The range sits over the track, invisible, so seeking works by pointer
 * and by keys. */
:root .proto-ui.proto-ui.proto-ui .mad-seek {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.mad-track:has(.mad-seek:focus-visible) {
  border-radius: 6px;
  box-shadow: 0 0 0 2px rgb(255 255 255 / 0.5);
}
.mad-time {
  flex: none;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.mad-play {
  position: absolute;
  bottom: 10px;
  left: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.55);
  color: #fff;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .mad-icon {
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mad-icon.is-label {
  width: auto;
  gap: 6px;
  padding: 0 12px 0 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  font-size: 13px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .mad-icon:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mad-icon.is-on {
  color: var(--color-base-foreground);
}
.mad-menu {
  position: absolute;
  z-index: 3;
  display: grid;
  min-width: 140px;
  padding: 4px;
  border-radius: 10px;
  background: var(--color-secondary-background);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
}
.mad-menu.is-down {
  top: calc(100% + 6px);
}
.mad-menu.is-up {
  bottom: calc(100% + 6px);
}
.mad-menu.is-down,
.mad-menu.is-end {
  right: 0;
}
.mad-menu.is-wide {
  right: auto;
  left: 0;
  min-width: 160px;
}
:root .proto-ui.proto-ui.proto-ui .mad-menu button {
  display: flex;
  height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 6px;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 13px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .mad-menu button:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mad-menu.is-more {
  min-width: 220px;
}
.mad-menu-chev {
  margin-left: auto;
  color: var(--color-muted-foreground);
  transition: rotate 0.12s ease;
}
.mad-menu-chev.is-open {
  rotate: 90deg;
}
/* Insert into workflow's two ways, in place under the row. */
.mad-menu-sub {
  display: grid;
  padding-left: 14px;
}
/* Delete sits apart by space, not a line. */
.mad-menu-gap {
  height: 6px;
}
:root .proto-ui.proto-ui.proto-ui .mad-menu button.is-danger {
  color: var(--color-status-danger);
}
:root .proto-ui.proto-ui.proto-ui .mad-icon:disabled {
  opacity: 0.35;
}
/* Along the bottom: the filmstrip from the left, the zoom on the right.
 * The resolution lives in Details. */
.mad-foot {
  position: absolute;
  right: 32px;
  bottom: 20px;
  left: 32px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
}
.mad-foot .zc {
  justify-self: end;
}
.mad-strip {
  min-width: 0;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 4px;
  scrollbar-width: none;
  --fade-start: #000;
  --fade-end: #000;
  mask-image: linear-gradient(
    to right,
    var(--fade-start),
    #000 48px,
    #000 calc(100% - 48px),
    var(--fade-end)
  );
}
.mad-strip.is-fade-start {
  --fade-start: transparent;
}
.mad-strip.is-fade-end {
  --fade-end: transparent;
}
:root .proto-ui.proto-ui.proto-ui .mad-thumb {
  position: relative;
  width: 52px;
  height: 52px;
  flex: none;
  overflow: hidden;
  padding: 0;
  border-radius: 8px;
  background: var(--color-secondary-background);
  opacity: 0.55;
  transition:
    opacity 0.12s ease,
    box-shadow 0.12s ease;
}
:root .proto-ui.proto-ui.proto-ui .mad-thumb:hover {
  opacity: 0.9;
}
:root .proto-ui.proto-ui.proto-ui .mad-thumb[aria-current='true'] {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-base-foreground);
  opacity: 1;
}
.mad-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mad-thumb .ac {
  position: absolute;
  inset: 0;
}
.mad-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px;
  gap: 10px 8px;
  margin: 0 16px;
  padding: 14px 0 16px;
}
.mad-actions > * {
  grid-column: 1 / -1;
}
/* Download on top, the rest under it as quieter rows: a soft fill, no
   line, no divider above. */
:root .proto-ui.proto-ui.proto-ui .mad-actions .mad-btn {
  height: 36px;
  flex: none;
  justify-content: flex-start;
  padding: 0 12px;
  border-radius: 10px;
  box-shadow: none;
}
:root .proto-ui.proto-ui.proto-ui .mad-actions .mad-btn:not(.is-primary) {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mad-actions .mad-btn:not(.is-primary):hover {
  background: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mad-actions .mad-btn.is-primary {
  order: -2;
  justify-content: center;
}
.mad-actions:not(:has(.is-wf)) > .is-primary {
  grid-column: 1;
}
.mad-actions > .is-wf {
  order: -1;
  grid-column: 1;
}
.mad-actions > .mad-pick {
  order: -1;
  grid-column: 2;
}
:root .proto-ui.proto-ui.proto-ui .mad-actions .mad-btn.is-more {
  width: 36px;
  flex: none;
  justify-content: center;
  padding: 0;
}
.mad-side {
  --mad-line: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  --mad-fill: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  --mad-ok: oklch(0.72 0.14 155);
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-content-background));
}
.mad-body {
  /* Name, details, label, tags, how it was made: spaced, no lines or
   * blocks. */
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 12px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.mad-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 20px 14px 8px 20px;
}
.mad-head-text {
  min-width: 0;
  flex: 1;
}
.mad-name {
  overflow-wrap: anywhere;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  text-wrap: balance;
}
.mad-sec {
  display: flex;
  min-width: 0;
  flex: none;
  flex-direction: column;
  gap: 10px;
  padding: 10px 20px;
}
.mad-label {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--color-muted-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.mad-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mad-rows div {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  font-size: 12px;
}
.mad-rows dt {
  flex: none;
  color: var(--color-muted-foreground);
}
.mad-rows dd {
  min-width: 0;
  overflow: hidden;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* A menu's anchor: the label picker, More. */
.mad-pick {
  position: relative;
  display: flex;
}
:root .proto-ui.proto-ui.proto-ui .mad-select {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--mad-fill);
  color: var(--color-base-foreground);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui .mad-select:hover,
:root .proto-ui.proto-ui.proto-ui .mad-select[aria-expanded='true'] {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mad-select svg {
  color: var(--color-muted-foreground);
}
.mad-menu-check {
  margin-left: auto;
}
.mad-dot {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: 999px;
}
.mad-dot.is-none {
  box-shadow: inset 0 0 0 1.5px color-mix(in oklch, var(--color-base-foreground) 30%, transparent);
}
.mad-tags {
  /* Suggestions open under the whole row, inside the panel. */
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.mad-tag {
  display: inline-flex;
  max-width: 100%;
  height: 24px;
  align-items: center;
  padding: 0 9px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  font-size: 12px;
}
.mad-tag-t {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .mad-tag-x {
  display: inline-flex;
  flex: none;
  margin: 0 -4px 0 4px;
  padding: 2px;
  border-radius: 999px;
  background: transparent;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mad-tag-x:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mad-tag.is-system {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--mad-line);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mad-tag-add {
  display: inline-flex;
  height: 24px;
  align-items: center;
  gap: 4px;
  padding: 0 9px;
  border-radius: 999px;
  background: transparent;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mad-tag-add:hover {
  background: var(--mad-fill);
  color: var(--color-base-foreground);
}
.mad-tag-pick {
  display: flex;
}
/* The field takes the button's place, chip-sized, so nothing moves. */
:root .proto-ui.proto-ui.proto-ui .mad-tag-field {
  width: 112px;
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
  font-size: 12px;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .mad-tag-field::placeholder {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mad-menu button.is-hi {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mad-tip {
  position: relative;
  display: inline-flex;
  padding: 2px;
  border-radius: 999px;
  color: var(--color-muted-foreground);
  cursor: help;
  outline: none;
}
.mad-tip:hover,
.mad-tip:focus-visible {
  color: var(--color-base-foreground);
}
.mad-tip:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--color-base-foreground) 30%, transparent);
}
.mad-tip-body {
  position: absolute;
  top: calc(100% + 6px);
  left: -8px;
  z-index: 2;
  width: 240px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-base-foreground);
  color: var(--color-content-background);
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0;
  line-height: 1.45;
  text-transform: none;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}
.mad-tip-body.is-short {
  width: max-content;
}
.mad-tip:hover .mad-tip-body,
.mad-tip:focus-visible .mad-tip-body {
  opacity: 1;
  transform: none;
}
:root .proto-ui.proto-ui.proto-ui .mad-icon.is-sm {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mad-icon.is-sm:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mad-head .mad-icon {
  margin-top: -4px;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mad-btn {
  display: inline-flex;
  min-width: 0;
  height: 32px;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui .mad-btn:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mad-btn.is-primary {
  background: var(--color-base-foreground);
  color: var(--color-content-background);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .mad-btn.is-primary:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 88%, transparent);
}
.mad-btn svg {
  flex: none;
}
.mad-btn span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Smaller windows: the frame takes more of them. */
@media (max-width: 1280px), (max-height: 760px) {
  .mad:not(.is-tab) {
    inset: 24px 64px;
  }
  :root .proto-ui.proto-ui.proto-ui .mad-x {
    top: 24px;
    right: 16px;
  }
}
/* Narrow windows: the details go under the picture. */
@media (max-width: 820px) {
  .mad {
    inset: 60px 8px 8px;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 46vh);
  }
  .mad.is-tab {
    inset: 0;
  }
  :root .proto-ui.proto-ui.proto-ui .mad-x {
    top: 12px;
    right: 12px;
  }
  .mad-foot {
    display: none;
  }

  .mad-view {
    inset: 56px 8px 12px;
  }
}
</style>
