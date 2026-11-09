<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Copy,
  Download,
  File as FileIcon,
  FileText,
  FolderOpen,
  Music,
  Workflow,
  X
} from 'lucide-vue-next'
import { thumb } from '../../mock'
import { toast } from '../../useProto'
import type { MarAsset } from '../pages/assetsStore'
import { factsFor, type Availability } from './assetFacts'
import { addTag, removeTag, tagsOf } from './assetTags'

/**
 * One asset, large (Better Asset Management PRD). One view for both
 * surfaces: ComfyUI opens it from Inspect asset with tags you can edit
 * (Phase 1), Desktop from its gallery with tags read-only (Phase 2). The
 * picture fills the window, the details sit on the right: the file, its
 * tags, what's on record, and what could be read from the run, labelled
 * as inferred, never as fact. Arrows step through the list as it's
 * filtered; Escape closes and hands focus back to the tile.
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
const glyph = computed(
  () => ({ audio: Music, '3d': Box, text: FileText })[asset.type as string] ?? FileIcon
)
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
    ['Added to library', added.value],
    ['Type', MIME[facts.value.format] ?? 'application/octet-stream'],
    ['File size', asset.size],
    ['Dimensions', dims.value],
    ['Duration', facts.value.duration],
    ['Run time', facts.value.seconds ? `${facts.value.seconds.toFixed(1)}s` : undefined]
  ].filter((r): r is [string, string] => !!r[1])
)

const STATE: Record<Availability, { label: string; icon: typeof CircleCheck }> = {
  available: { label: 'Available', icon: CircleCheck },
  missing: { label: 'Not in this file', icon: CircleSlash },
  lost: { label: 'Not kept after a restart', icon: CircleDashed }
}
const sources = computed(() => [
  { name: 'File metadata', state: facts.value.metadata },
  { name: 'Embedded workflow', state: facts.value.workflow },
  {
    name: 'Execution history',
    state: facts.value.imported ? ('missing' as const) : facts.value.history,
    note: facts.value.imported ? 'None, imported' : undefined
  }
])

const KIND: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  '3d': '3D model',
  text: 'Text',
  other: 'File'
}
const summary = computed(() =>
  [KIND[asset.type] ?? 'File', facts.value.format, dims.value, facts.value.duration]
    .filter(Boolean)
    .join(' · ')
)
/** The node a model was loaded by, as the run records it. */
const loader = computed(() => (asset.type === 'video' ? 'UNETLoader' : 'CheckpointLoaderSimple'))

const copied = ref('')
let copyTimer = 0
function copy(what: string, text = ''): void {
  navigator.clipboard?.writeText(text).catch(() => {})
  copied.value = what
  clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => (copied.value = ''), 1400)
}

const json = ref(false)
watch(
  () => asset.id,
  () => (json.value = false)
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
  clearTimeout(copyTimer)
  opener?.focus?.()
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="proto-ui mad"
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
          <button type="button" class="mad-icon" aria-label="Close" @click="emit('close')">
            <X :size="16" />
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
        <div class="mad-media" :style="{ '--r': facts.ratio }">
          <img v-if="pic" :key="asset.id" :src="pic" alt="" />
          <span v-else class="mad-glyph"><component :is="glyph" :size="36" /></span>
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
      </section>

      <aside class="mad-side" aria-label="Asset details">
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
            <h3 class="mad-label">Tags</h3>
            <div class="mad-tags">
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
              <input
                v-if="editable"
                v-model="draft"
                class="mad-tag-input"
                placeholder="Add a tag"
                aria-label="Add a tag"
                @keydown.enter.prevent="add"
              />
              <span v-else-if="!tags.length" class="mad-quiet">No tags</span>
            </div>
            <p class="mad-hint">
              {{ editable ? 'Press Enter to add.' : 'Tags are edited in ComfyUI.' }} System tag:
              <span class="mad-chip">{{ facts.imported ? 'input' : 'output' }}</span>
            </p>
          </section>

          <section class="mad-sec">
            <h3 class="mad-label">Available information</h3>
            <ul class="mad-avail">
              <li v-for="s in sources" :key="s.name" :class="`is-${s.state}`">
                <span class="mad-avail-k">{{ s.name }}</span>
                <span class="mad-avail-v"
                  ><component :is="STATE[s.state].icon" :size="13" />{{
                    s.note ?? STATE[s.state].label
                  }}</span
                >
              </li>
            </ul>
          </section>

          <section class="mad-sec">
            <h3 class="mad-label">Generation info</h3>
            <div v-if="loading" class="mad-skel" aria-label="Loading">
              <i style="width: 90%" /><i style="width: 70%" /><i style="width: 50%" />
            </div>
            <template v-else-if="facts.prompt || facts.models.length">
              <p class="mad-hint">
                Inferred from the run’s data. A listed value may not have contributed to this
                output.
              </p>
              <div v-if="facts.prompt" class="mad-card">
                <div class="mad-card-head">
                  <span class="mad-card-k">Prompt</span>
                  <span class="mad-node">{{ facts.promptNode }} #6</span>
                  <button
                    type="button"
                    class="mad-icon is-sm"
                    :aria-label="copied === 'prompt' ? 'Copied' : 'Copy prompt'"
                    :title="copied === 'prompt' ? 'Copied' : 'Copy prompt'"
                    @click="copy('prompt', facts.prompt)"
                  >
                    <Check v-if="copied === 'prompt'" :size="13" /><Copy v-else :size="13" />
                  </button>
                </div>
                <p class="mad-prompt">{{ facts.prompt }}</p>
              </div>
              <div class="mad-card">
                <div class="mad-card-head">
                  <span class="mad-card-k">Models</span>
                  <span class="mad-node">{{ loader }} #4</span>
                </div>
                <p v-for="m in facts.models" :key="m" class="mad-model" :title="m">{{ m }}</p>
                <p v-if="!facts.models.length" class="mad-quiet">Not identified</p>
              </div>
            </template>
            <p v-else class="mad-quiet">
              {{
                facts.imported
                  ? 'Imported files carry no run.'
                  : facts.history === 'available'
                    ? 'Not identified in the run’s data.'
                    : 'Not identified. The run’s data wasn’t kept.'
              }}
            </p>

            <div v-if="facts.json && !loading" class="mad-json">
              <div class="mad-json-head">
                <button
                  type="button"
                  class="mad-json-toggle"
                  :aria-expanded="json"
                  @click="json = !json"
                >
                  <ChevronRight :size="14" :class="json && 'rotate-90'" />Run data (JSON)
                </button>
                <button
                  v-if="json"
                  type="button"
                  class="mad-icon is-sm"
                  :aria-label="copied === 'json' ? 'Copied' : 'Copy JSON'"
                  :title="copied === 'json' ? 'Copied' : 'Copy JSON'"
                  @click="copy('json', facts.json)"
                >
                  <Check v-if="copied === 'json'" :size="13" /><Copy v-else :size="13" />
                </button>
              </div>
              <pre v-if="json">{{ facts.json }}</pre>
            </div>
          </section>
        </div>

        <footer class="mad-foot">
          <button
            v-if="facts.workflow === 'available'"
            type="button"
            class="mad-btn"
            :title="editable ? 'Open as workflow in new tab' : `Open the workflow in ${build}`"
            @click="
              toast(
                editable ? `Opened ${asset.name} as a workflow` : `Opening the workflow in ${build}`
              )
            "
          >
            <Workflow :size="14" /><span>{{
              editable ? 'Open as workflow' : 'Open workflow'
            }}</span>
          </button>
          <button
            type="button"
            class="mad-btn is-primary"
            @click="toast(`Downloading ${asset.name}`)"
          >
            <Download :size="14" /><span>Download</span>
          </button>
        </footer>
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
  gap: 20px;
  padding: 64px 24px 32px;
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
.mad-glyph {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: var(--color-muted-foreground);
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
  width: 40px;
  height: 40px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mad-icon:hover,
:root .proto-ui.proto-ui.proto-ui .mad-arrow:hover:not(:disabled) {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mad-arrow:disabled {
  opacity: 0.3;
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
.mad-row,
.mad-avail li {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}
.mad-row dt,
.mad-avail-k {
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
:root .proto-ui.proto-ui.proto-ui .mad-tag-input {
  width: 96px;
  min-width: 0;
  height: 24px;
  flex: 1 0 96px;
  padding: 0 9px;
  border: 1px dashed color-mix(in oklch, var(--color-base-foreground) 18%, transparent);
  border-radius: 999px;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 12px;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .mad-tag-input:focus {
  border-style: solid;
  border-color: color-mix(in oklch, var(--color-base-foreground) 32%, transparent);
}
.mad-chip {
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--mad-fill);
  color: var(--color-muted-foreground);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
}
.mad-hint,
.mad-quiet {
  color: var(--color-subtle-foreground, var(--color-muted-foreground));
  font-size: 12px;
  line-height: 1.45;
}
.mad-quiet {
  font-size: 13px;
}
.mad-avail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}
.mad-avail-v {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  color: var(--color-muted-foreground);
  text-align: right;
}
.mad-avail-v svg {
  flex: none;
}
.mad-avail .is-available .mad-avail-v {
  color: var(--color-base-foreground);
}
.mad-avail .is-available svg {
  color: var(--mad-ok);
}
.mad-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 12px;
  border: 1px solid var(--mad-line);
  border-radius: 10px;
}
.mad-card-head {
  display: flex;
  min-width: 0;
  min-height: 24px;
  align-items: center;
  gap: 8px;
}
.mad-card-k {
  flex: none;
  font-size: 12px;
  font-weight: 500;
}
.mad-node {
  min-width: 0;
  overflow: hidden;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--mad-fill);
  color: var(--color-muted-foreground);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .mad-card-head .mad-icon {
  margin-left: auto;
}
.mad-prompt {
  max-height: 9.5em;
  overflow-y: auto;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.5;
}
.mad-model {
  overflow: hidden;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mad-skel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mad-skel i {
  height: 10px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mad-json-head {
  display: flex;
  min-height: 24px;
  align-items: center;
  justify-content: space-between;
}
:root .proto-ui.proto-ui.proto-ui .mad-json-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: -2px;
  padding: 0;
  background: transparent;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mad-json-toggle:hover {
  color: var(--color-base-foreground);
}
.mad-json-toggle svg {
  transition: rotate 0.15s ease;
}
.mad-json pre {
  max-height: 240px;
  margin-top: 8px;
  overflow: auto;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--mad-fill);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre;
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
.mad-foot {
  display: flex;
  flex: none;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--mad-line);
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
    padding: 60px 12px 16px;
    gap: 8px;
  }
  .mad-media {
    width: min(100%, calc((54vh - 80px) * var(--r)));
  }
}
</style>
