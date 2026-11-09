<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Box,
  ChevronDown,
  Download,
  FolderOpen,
  Info,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  SquareSplitHorizontal,
  Workflow,
  X
} from 'lucide-vue-next'
import { onClickOutside, useResizeObserver } from '@vueuse/core'
import { thumb } from '../../mock'
import { toast } from '../../useProto'
import type { MarAsset } from '../pages/assetsStore'
import { factsFor } from './assetFacts'
import { saveFile } from './saveFile'
import AssetCover from './AssetCover.vue'
import GenerationInfo from './GenerationInfo.vue'
import { addTag, removeTag, tagsOf } from './assetTags'

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
 */
const {
  asset,
  list,
  build,
  editable = false,
  tab = false,
  saveable = false
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
}>()
const emit = defineEmits<{ close: []; go: [asset: MarAsset]; save: [] }>()

const facts = computed(() => factsFor(asset))
const tags = computed(() => tagsOf(asset))
const draft = ref('')
function add(): void {
  addTag(asset, draft.value)
  draft.value = ''
}
const pic = computed(() => asset.src ?? (asset.thumbId ? thumb(asset.thumbId) : undefined))
const MIME: Record<string, string> = {
  PNG: 'image/png',
  JPG: 'image/jpeg',
  JPEG: 'image/jpeg',
  WEBP: 'image/webp',
  MP4: 'video/mp4',
  WEBM: 'video/webm',
  WAV: 'audio/wav',
  MP3: 'audio/mpeg',
  FLAC: 'audio/flac',
  GLB: 'model/gltf-binary',
  OBJ: 'model/obj',
  TXT: 'text/plain',
  ZIP: 'application/zip',
  MD: 'text/markdown',
  JSON: 'application/json',
  CSV: 'text/csv'
}
const added = computed(() =>
  new Date(Date.now() - Math.max(0, asset.age) * 60000).toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
)
const at = computed(() => list.findIndex((a) => a.id === asset.id))
const picOf = (a: MarAsset): string | undefined =>
  a.src ?? (a.thumbId ? thumb(a.thumbId) : undefined)

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
const shownPct = computed(() => Math.round(fit.value * zoom.value))
const ZOOMS = [50, 100, 200]
const zoomMenu = ref(false)
const zoomBox = ref<HTMLElement>()
onClickOutside(zoomBox, () => (zoomMenu.value = false))
function zoomTo(pct?: number): void {
  zoom.value = pct ? Math.min(800, Math.max(10, pct / fit.value)) : 100
  zoomMenu.value = false
}
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
const fileRows = computed(() =>
  [
    ['Type', MIME[facts.value.format] ?? 'application/octet-stream'],
    ['Dimensions', dims.value],
    ['Duration', facts.value.duration],
    ['Run time', facts.value.seconds ? `${facts.value.seconds.toFixed(1)}s` : undefined],
    // When the file came to be: made by a run, or brought in.
    [facts.value.imported ? 'Imported' : 'Created', added.value]
  ].filter((r): r is [string, string] => !!r[1])
)

const KIND: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  '3d': '3D model',
  text: 'Text',
  other: 'File'
}
const summary = computed(() =>
  [KIND[asset.type] ?? 'File', facts.value.format, asset.size].filter(Boolean).join(' · ')
)
const root = ref<HTMLElement>()
const opener = document.activeElement as HTMLElement | null
function key(e: KeyboardEvent): void {
  if (e.target instanceof HTMLInputElement && e.key !== 'Escape') return
  if (e.key === 'Escape' && !tab) emit('close')
  else if (e.key === 'ArrowLeft' && prev.value) emit('go', prev.value)
  else if (e.key === 'ArrowRight' && next.value) emit('go', next.value)
  else return
  e.preventDefault()
  e.stopPropagation()
}
onMounted(async () => {
  window.addEventListener('keydown', key, true)
  await nextTick()
  if (!tab) root.value?.focus()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', key, true)
  clearTimeout(timer)
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
          <header class="mad-bar">
            <span class="mad-file">{{ asset.name }}</span>
            <span class="mad-count">{{ build }} · {{ at + 1 }} / {{ list.length }}</span>
            <button
              type="button"
              class="mad-icon"
              :class="!side && 'is-label'"
              :aria-label="side ? 'Hide details' : 'Show details'"
              :title="side ? 'Hide details' : 'Show details'"
              :aria-pressed="side"
              @click="side = !side"
            >
              <PanelRightClose v-if="side" :size="16" /><template v-else
                ><PanelRightOpen :size="16" />Details</template
              >
            </button>
          </header>
          <!-- The picture is clipped to its own area: zoomed in, it never
               runs under the bar or the filmstrip. -->
          <div class="mad-view">
            <div ref="media" class="mad-media" :style="{ '--r': facts.ratio, scale: zoom / 100 }">
              <img v-if="pic" :key="asset.id" :src="pic" alt="" @load="measure" />
              <AssetCover v-else :name="asset.name" :type="asset.type" />
              <span v-if="asset.type === 'video'" class="mad-play">{{ facts.duration }}</span>
              <span v-if="asset.type === '3d'" class="mad-play"><Box :size="12" />3D</span>
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
            <div ref="zoomBox" class="mad-zoom" role="group" aria-label="Zoom">
              <button
                type="button"
                class="mad-icon is-sm"
                :class="zoom === 100 && 'is-on'"
                aria-label="Fit to screen"
                title="Fit to screen"
                @click="zoomTo()"
              >
                <SquareSplitHorizontal :size="15" />
              </button>
              <button
                type="button"
                class="mad-zoom-pct"
                aria-haspopup="menu"
                :aria-expanded="zoomMenu"
                @click="zoomMenu = !zoomMenu"
              >
                <span>{{ shownPct }}%</span><ChevronDown :size="13" />
              </button>
              <div v-if="zoomMenu" class="mad-zoom-menu" role="menu">
                <button type="button" role="menuitem" @click="zoomTo()">Fit to screen</button>
                <button
                  v-for="z in ZOOMS"
                  :key="z"
                  type="button"
                  role="menuitem"
                  @click="zoomTo(z)"
                >
                  {{ z }}%
                </button>
              </div>
            </div>
          </footer>
        </section>

        <aside v-if="side" class="mad-side" aria-label="Asset details">
          <div class="mad-body">
            <header class="mad-head">
              <div class="mad-head-text">
                <h2 class="mad-name">{{ asset.name }}</h2>
                <p class="mad-sub">{{ summary }}</p>
              </div>
              <button
                v-if="!editable"
                type="button"
                class="mad-icon"
                aria-label="Show in Finder"
                title="Show in Finder"
                @click="toast(`Revealed ${asset.name}`)"
              >
                <FolderOpen :size="15" />
              </button>
            </header>

            <section class="mad-sec">
              <dl class="mad-rows">
                <div v-for="[k, v] in fileRows" :key="k" class="mad-row">
                  <dt>{{ k }}</dt>
                  <dd :title="v">{{ v }}</dd>
                </div>
              </dl>
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
                <label v-if="editable" class="mad-tag-add">
                  <Plus :size="12" />
                  <input
                    v-model="draft"
                    placeholder="Add tag"
                    aria-label="Add a tag"
                    @keydown.enter.prevent="add"
                  />
                </label>
              </div>
            </section>

            <section class="mad-sec">
              <h3 class="mad-label">
                Generation info
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
          <!-- At the bottom, labeled: only the actions this file has. -->
          <footer class="mad-actions">
            <button
              v-if="facts.workflow === 'available'"
              type="button"
              class="mad-btn"
              :title="editable ? 'Open as workflow in new tab' : `Open the workflow in ${build}`"
              @click="
                toast(
                  editable
                    ? `Opened ${asset.name} as a workflow`
                    : `Opening the workflow in ${build}`
                )
              "
            >
              <Workflow :size="14" /><span>{{
                editable ? 'Open as workflow' : 'Open workflow'
              }}</span>
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
  background: rgb(0 0 0 / 0.35);
  -webkit-backdrop-filter: blur(16px) saturate(0.9);
  backdrop-filter: blur(16px) saturate(0.9);
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
  overflow: hidden;
  border-radius: var(--radius-card, 16px);
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
  inset: 60px 16px 84px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  /* The picture fits this area, not the window. */
  container-type: size;
}
.mad-bar {
  position: absolute;
  top: 14px;
  right: 16px;
  left: 16px;
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
.mad-count {
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.mad-media {
  position: relative;
  transition: scale 0.16s ease-out;
  width: min(100%, calc(100cqh * var(--r)));
  min-width: 0;
  flex: 0 1 auto;
  aspect-ratio: var(--r);
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-secondary-background);
}
.mad-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
/* Zoom: fit, then the real-size percentage opening its presets. */
.mad-zoom {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
}
:root .proto-ui.proto-ui.proto-ui .mad-icon.is-on {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mad-zoom-pct {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 10px;
  border-radius: 7px;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .mad-zoom-pct span {
  min-width: 34px;
  text-align: center;
}
:root .proto-ui.proto-ui.proto-ui .mad-zoom-pct:hover,
:root .proto-ui.proto-ui.proto-ui .mad-zoom-pct[aria-expanded='true'] {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mad-zoom-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  display: grid;
  min-width: 140px;
  padding: 4px;
  border-radius: 10px;
  background: var(--color-secondary-background);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
}
:root .proto-ui.proto-ui.proto-ui .mad-zoom-menu button {
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 13px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .mad-zoom-menu button:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mad-icon:disabled {
  opacity: 0.35;
}
/* Along the bottom: the filmstrip from the left, the zoom on the right.
 * The resolution lives in Details. */
.mad-foot {
  position: absolute;
  right: 16px;
  bottom: 14px;
  left: 16px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
}
.mad-foot .mad-zoom {
  justify-self: end;
  padding: 3px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
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
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 20px 16px;
  border-top: 1px solid var(--mad-line);
}
.mad-side {
  --mad-line: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  --mad-fill: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  --mad-ok: oklch(0.72 0.14 155);
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-left: 1px solid var(--mad-line);
  background: var(--color-content-background);
}
.mad-body {
  min-height: 0;
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.mad-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 20px 16px 16px 20px;
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
.mad-sub {
  margin-top: 4px;
  overflow: hidden;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mad-sec {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid var(--mad-line);
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
  gap: 8px;
  font-size: 13px;
}
.mad-row {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}
.mad-row dt {
  flex: none;
  color: var(--color-muted-foreground);
}
.mad-row dd {
  min-width: 0;
  overflow: hidden;
  font-variant-numeric: tabular-nums;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mad-tags {
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
.mad-tag-add {
  display: inline-flex;
  height: 24px;
  flex: 0 1 112px;
  min-width: 0;
  align-items: center;
  gap: 4px;
  padding: 0 9px;
  border-radius: 999px;
  color: var(--color-muted-foreground);
  cursor: text;
}
.mad-tag-add:hover,
.mad-tag-add:focus-within {
  background: var(--mad-fill);
  color: var(--color-base-foreground);
}
.mad-tag-add svg {
  flex: none;
}
:root .proto-ui.proto-ui.proto-ui .mad-tag-add input {
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 12px;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .mad-tag-add input::placeholder {
  color: var(--color-muted-foreground);
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
  .mad-side {
    border-top: 1px solid var(--mad-line);
    border-left: 0;
  }
  .mad-view {
    inset: 56px 8px 12px;
  }
}
</style>
