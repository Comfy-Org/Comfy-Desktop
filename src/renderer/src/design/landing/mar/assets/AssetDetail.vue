<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  Box,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  Info,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Workflow,
  X
} from 'lucide-vue-next'
import { thumb } from '../../mock'
import { toast } from '../../useProto'
import type { MarAsset } from '../pages/assetsStore'
import { factsFor } from './assetFacts'
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
 * the tile. Zoom and a panel toggle sit in the bar, Download leads the
 * details (Alex Tov's media-assets proto).
 */
const {
  asset,
  list,
  build,
  editable = false
} = defineProps<{
  asset: MarAsset
  list: MarAsset[]
  /** The build whose catalog this is. */
  build: string
  /** ComfyUI: tags are edited here. */
  editable?: boolean
}>()
const emit = defineEmits<{ close: []; go: [asset: MarAsset] }>()

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

/** Zoom: 50 to 300%, back to 100 on every asset. */
const zoom = ref(100)
const ZOOM_STEP = 25
const setZoom = (z: number): void => {
  zoom.value = Math.min(300, Math.max(50, Math.round(z / ZOOM_STEP) * ZOOM_STEP))
}
/** The details panel folds away for the picture alone. */
const side = ref(true)

// The filmstrip keeps the current asset in view.
const strip = ref<HTMLElement>()
watch(
  () => asset.id,
  async () => {
    zoom.value = 100
    await nextTick()
    strip.value
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' })
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
  if (e.key === 'Escape') emit('close')
  else if (e.key === 'ArrowLeft' && prev.value) emit('go', prev.value)
  else if (e.key === 'ArrowRight' && next.value) emit('go', next.value)
  else return
  e.preventDefault()
  e.stopPropagation()
}
onMounted(async () => {
  window.addEventListener('keydown', key, true)
  await nextTick()
  root.value?.focus()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', key, true)
  clearTimeout(timer)
  opener?.focus?.()
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="proto-ui mad"
      :class="!side && 'no-side'"
      role="dialog"
      aria-modal="true"
      :aria-label="asset.name"
      tabindex="-1"
    >
      <section class="mad-stage" @pointerdown.self="emit('close')">
        <header class="mad-bar">
          <button type="button" class="mad-back" @click="emit('close')">
            <ArrowLeft :size="14" />Assets
          </button>
          <span class="mad-file">{{ asset.name }}</span>
          <span class="mad-count">{{ build }} · {{ at + 1 }} / {{ list.length }}</span>
          <div class="mad-zoom" role="group" aria-label="Zoom">
            <button
              type="button"
              class="mad-icon is-sm"
              aria-label="Zoom out"
              :disabled="zoom <= 50"
              @click="setZoom(zoom - ZOOM_STEP)"
            >
              <Minus :size="14" />
            </button>
            <input
              type="range"
              min="50"
              max="300"
              :step="ZOOM_STEP"
              :value="zoom"
              aria-label="Zoom"
              @input="setZoom(+($event.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="mad-icon is-sm"
              aria-label="Zoom in"
              :disabled="zoom >= 300"
              @click="setZoom(zoom + ZOOM_STEP)"
            >
              <Plus :size="14" />
            </button>
            <button type="button" class="mad-zoom-pct" title="Reset to 100%" @click="zoom = 100">
              {{ zoom }}%
            </button>
          </div>
          <button
            type="button"
            class="mad-icon"
            :aria-label="side ? 'Hide details' : 'Show details'"
            :title="side ? 'Hide details' : 'Show details'"
            :aria-pressed="side"
            @click="side = !side"
          >
            <PanelRightClose v-if="side" :size="16" /><PanelRightOpen v-else :size="16" />
          </button>
        </header>
        <button
          type="button"
          class="mad-arrow"
          aria-label="Previous asset"
          :disabled="!prev"
          @click="prev && emit('go', prev)"
        >
          <ChevronLeft :size="18" />
        </button>
        <div class="mad-media" :style="{ '--r': facts.ratio, scale: zoom / 100 }">
          <img v-if="pic" :key="asset.id" :src="pic" alt="" />
          <AssetCover v-else :name="asset.name" :type="asset.type" />
          <span v-if="asset.type === 'video'" class="mad-play">{{ facts.duration }}</span>
          <span v-if="asset.type === '3d'" class="mad-play"><Box :size="12" />3D</span>
        </div>
        <button
          type="button"
          class="mad-arrow is-right"
          aria-label="Next asset"
          :disabled="!next"
          @click="next && emit('go', next)"
        >
          <ChevronRight :size="18" />
        </button>
        <nav ref="strip" class="mad-strip" aria-label="Assets">
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
          <div class="mad-actions">
            <button
              type="button"
              class="mad-btn is-primary"
              @click="toast(`Downloading ${asset.name}`)"
            >
              <Download :size="14" /><span>Download</span>
            </button>
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
          </div>

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
      </aside>
    </div>
  </Teleport>
</template>

<style>
.mad {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(320px, 30vw, 400px);
  background: color-mix(in oklch, var(--color-content-background) 94%, transparent);
  backdrop-filter: blur(28px);
  color: var(--color-base-foreground);
  outline: none;
  animation: mad-in 0.18s ease-out;
}
.mad.no-side {
  grid-template-columns: minmax(0, 1fr);
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
  padding: 64px 72px 104px;
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
  width: min(100%, calc(78vh * var(--r)));
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
:root .proto-ui.proto-ui.proto-ui .mad-icon,
:root .proto-ui.proto-ui.proto-ui .mad-arrow {
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
:root .proto-ui.proto-ui.proto-ui .mad-arrow {
  /* Pinned to the stage's edges: they stay put whatever the asset's width. */
  position: absolute;
  top: 50%;
  left: 16px;
  z-index: 1;
  width: 40px;
  height: 40px;
  translate: 0 -50%;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mad-arrow.is-right {
  right: 16px;
  left: auto;
}
:root .proto-ui.proto-ui.proto-ui .mad-icon:hover,
:root .proto-ui.proto-ui.proto-ui .mad-arrow:hover:not(:disabled) {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mad-arrow:disabled {
  opacity: 0.3;
}

/* Zoom: − slider + and the percentage, which resets to 100. */
.mad-zoom {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
}
:root .proto-ui.proto-ui.proto-ui .mad-zoom input {
  width: 88px;
  margin: 0 4px;
  accent-color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mad-zoom-pct {
  width: 44px;
  padding: 0;
  background: transparent;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
:root .proto-ui.proto-ui.proto-ui .mad-zoom-pct:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mad-icon:disabled {
  opacity: 0.35;
}
/* Filmstrip: every asset in the list, the current one ringed. */
.mad-strip {
  position: absolute;
  right: 16px;
  bottom: 16px;
  left: 16px;
  display: flex;
  justify-content: safe center;
  gap: 6px;
  overflow-x: auto;
  padding: 4px;
  scrollbar-width: none;
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
  gap: 8px;
  padding: 0 20px 16px;
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

/* Narrow windows: the details go under the picture. */
@media (max-width: 820px) {
  .mad {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 46vh);
  }
  .mad-side {
    border-top: 1px solid var(--mad-line);
    border-left: 0;
  }
  .mad-stage {
    padding: 60px 56px 16px;
  }
  .mad-media {
    width: min(100%, calc((54vh - 80px) * var(--r)));
  }
  :root .proto-ui.proto-ui.proto-ui .mad-arrow {
    left: 8px;
  }
  :root .proto-ui.proto-ui.proto-ui .mad-arrow.is-right {
    right: 8px;
    left: auto;
  }
}
</style>
