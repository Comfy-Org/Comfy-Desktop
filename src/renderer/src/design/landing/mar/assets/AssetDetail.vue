<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleSlash,
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
        <div class="mad-head">
          <h2 class="mad-name">{{ asset.name }}</h2>
        </div>

        <section class="mad-sec">
          <dl class="mad-rows">
            <template v-for="[k, v] in fileRows" :key="k">
              <dt>{{ k }}</dt>
              <dd>{{ v }}</dd>
            </template>
          </dl>
        </section>

        <section class="mad-sec">
          <p class="mad-label">Tags</p>
          <div v-if="tags.length" class="mad-tags">
            <span v-for="t in tags" :key="t" class="mad-tag"
              >{{ t
              }}<button
                v-if="editable"
                type="button"
                class="mad-tag-x"
                :aria-label="`Remove ${t}`"
                @click="removeTag(asset, t)"
              >
                <X :size="11" /></button
            ></span>
          </div>
          <p v-else class="mad-quiet">No tags yet</p>
          <input
            v-if="editable"
            v-model="draft"
            class="mad-tag-input"
            placeholder="Add a tag"
            aria-label="Add a tag"
            @keydown.enter.prevent="add"
          />
          <p v-else class="mad-hint">Tags are edited in ComfyUI.</p>
          <p class="mad-hint">System tags: {{ facts.imported ? 'input' : 'output' }}</p>
        </section>

        <section class="mad-sec">
          <p class="mad-label">Available information</p>
          <dl class="mad-avail">
            <template v-for="s in sources" :key="s.name">
              <dt>{{ s.name }}</dt>
              <dd :class="`is-${s.state}`">
                <component :is="STATE[s.state].icon" :size="13" />{{
                  s.note ?? STATE[s.state].label
                }}
              </dd>
            </template>
          </dl>
        </section>

        <section class="mad-sec">
          <p class="mad-label">Generation info</p>
          <p v-if="facts.prompt || facts.models.length" class="mad-hint">
            Inferred from the run’s data. A listed value may not have contributed to this output.
          </p>
          <div v-if="loading" class="mad-skel" aria-label="Loading">
            <i style="width: 90%" /><i style="width: 70%" /><i style="width: 50%" />
          </div>
          <template v-else-if="facts.prompt || facts.models.length">
            <div v-if="facts.prompt" class="mad-found">
              <p class="mad-found-k">
                Prompt <span>{{ facts.promptNode }} #6</span>
              </p>
              <p class="mad-prompt">{{ facts.prompt }}</p>
            </div>
            <div class="mad-found">
              <p class="mad-found-k">Models <span>CheckpointLoaderSimple #4</span></p>
              <p v-for="m in facts.models" :key="m" class="mad-model">{{ m }}</p>
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
            <button
              type="button"
              class="mad-json-toggle"
              :aria-expanded="json"
              @click="json = !json"
            >
              <ChevronDown :size="14" :class="!json && '-rotate-90'" />Run data (JSON)
            </button>
            <pre v-if="json">{{ facts.json }}</pre>
          </div>
        </section>
        <footer class="mad-foot">
          <template v-if="editable">
            <button
              v-if="facts.workflow === 'available'"
              type="button"
              class="mad-btn"
              @click="toast(`Opened ${asset.name} as a workflow`)"
            >
              <Workflow :size="14" />Open as workflow in new tab
            </button>
          </template>
          <template v-else>
            <button type="button" class="mad-btn" @click="toast(`Revealed ${asset.name}`)">
              <FolderOpen :size="14" />Show in Finder
            </button>
            <button
              v-if="facts.workflow === 'available'"
              type="button"
              class="mad-btn"
              @click="toast(`Opening the workflow in ${build}`)"
            >
              <Workflow :size="14" />Open workflow
            </button>
          </template>
          <button
            type="button"
            class="mad-btn is-primary"
            @click="toast(`Downloading ${asset.name}`)"
          >
            <Download :size="14" />Download
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
  grid-template-columns: minmax(0, 1fr) 360px;
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
.mad-foot {
  position: sticky;
  bottom: -32px;
  display: flex;
  gap: 8px;
  margin: auto -24px -32px;
  padding: 14px 24px;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  background: var(--color-content-background);
}
:root .proto-ui.proto-ui.proto-ui .mad-tag-x {
  display: inline-flex;
  margin: 0 -3px 0 4px;
  padding: 0;
  background: transparent;
  color: var(--color-muted-foreground);
  vertical-align: -1px;
}
:root .proto-ui.proto-ui.proto-ui .mad-tag-x:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mad-tag-input {
  height: 32px;
  padding: 0 10px;
  border: 1px solid color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  border-radius: 8px;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 13px;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .mad-tag-input:focus {
  border-color: color-mix(in oklch, var(--color-base-foreground) 30%, transparent);
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
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 22px;
  overflow-y: auto;
  padding: 24px 24px 32px;
  border-left: 1px solid color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  background: var(--color-content-background);
}
.mad-name {
  overflow-wrap: anywhere;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.35;
}
.mad-sub {
  margin-top: 4px;
  color: var(--color-muted-foreground);
  font-size: 13px;
}
.mad-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
:root .proto-ui.proto-ui.proto-ui .mad-btn {
  display: inline-flex;
  height: 32px;
  align-items: center;
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
.mad-btn svg {
  flex: none;
}
.mad-foot .mad-btn {
  min-width: 0;
  flex: 1 1 auto;
  justify-content: center;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .mad-btn.is-primary {
  background: var(--color-base-foreground);
  color: var(--color-content-background);
}
.mad-sec {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mad-label {
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
}
.mad-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mad-tag {
  padding: 3px 9px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  font-size: 12px;
}
.mad-hint,
.mad-quiet {
  color: var(--color-subtle-foreground, var(--color-muted-foreground));
  font-size: 12px;
}
.mad-quiet {
  font-size: 13px;
}
.mad-rows,
.mad-avail {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px 16px;
  font-size: 13px;
}
.mad-rows dt,
.mad-avail dt {
  color: var(--color-muted-foreground);
}
.mad-rows dd {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.mad-avail dd {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  text-align: right;
}
.mad-avail dd.is-missing,
.mad-avail dd.is-lost {
  color: var(--color-muted-foreground);
}
.mad-found {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mad-found-k {
  font-size: 13px;
  font-weight: 500;
}
.mad-found-k span {
  margin-left: 6px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 400;
}
.mad-prompt {
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  font-size: 13px;
  line-height: 1.45;
}
.mad-model {
  overflow-wrap: anywhere;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
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
:root .proto-ui.proto-ui.proto-ui .mad-json-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 13px;
}
.mad-json pre {
  max-height: 240px;
  margin-top: 8px;
  overflow: auto;
  padding: 10px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre;
}
</style>
