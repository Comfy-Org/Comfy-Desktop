<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Download,
  FolderOpen,
  Music,
  Workflow,
  X
} from 'lucide-vue-next'
import { thumb } from '../../mock'
import { toast } from '../../useProto'
import type { MarAsset } from '../pages/assetsStore'
import { factsFor, type Availability } from './assetFacts'

/**
 * One asset, large (Better Asset Management PRD, Phase 2: Desktop). The
 * picture fills the window, the details sit on the right: the file, its
 * tags (read-only here, they're edited in ComfyUI), and what could be
 * read from the run that made it, labelled as found, never as fact.
 * Arrows step through the gallery as it's filtered; Escape closes and
 * hands focus back to the tile.
 */
const { asset, list, build } = defineProps<{
  asset: MarAsset
  list: MarAsset[]
  /** The build whose catalog this is. */
  build: string
}>()
const emit = defineEmits<{ close: []; go: [asset: MarAsset] }>()

const facts = computed(() => factsFor(asset))
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
    ['Type', `${facts.value.format} ${asset.type === '3d' ? 'model' : asset.type}`],
    ['Size', asset.size],
    ['Dimensions', dims.value],
    ['Duration', facts.value.duration],
    [facts.value.imported ? 'Added' : 'Made', asset.when],
    ['Run time', facts.value.seconds ? `${facts.value.seconds.toFixed(1)}s` : undefined]
  ].filter((r): r is [string, string] => !!r[1])
)

const STATE: Record<Availability, { label: string; icon: typeof CircleCheck }> = {
  available: { label: 'Available', icon: CircleCheck },
  missing: { label: 'Not in this file', icon: CircleSlash },
  lost: { label: 'Not kept after a restart', icon: CircleDashed }
}
const sources = computed(() => [
  { name: 'Embedded workflow', state: facts.value.workflow },
  {
    name: 'Run history',
    state: facts.value.imported ? ('missing' as const) : facts.value.history,
    note: facts.value.imported ? 'Imported' : undefined
  },
  { name: 'File metadata', state: facts.value.metadata }
])

const json = ref(false)
watch(
  () => asset.id,
  () => (json.value = false)
)

const root = ref<HTMLElement>()
const opener = document.activeElement as HTMLElement | null
function key(e: KeyboardEvent): void {
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
          <span class="mad-count">{{ at + 1 }} of {{ list.length }}</span>
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
          <img v-if="asset.thumbId" :key="asset.id" :src="thumb(asset.thumbId)" alt="" />
          <span v-else class="mad-glyph"><Music :size="36" /></span>
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
          <p class="mad-sub">{{ build }} · {{ asset.when }}</p>
        </div>

        <div class="mad-actions">
          <button
            type="button"
            class="mad-btn is-primary"
            @click="toast(`Downloading ${asset.name}`)"
          >
            <Download :size="14" />Download
          </button>
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
        </div>

        <section class="mad-sec">
          <p class="mad-label">Tags</p>
          <div v-if="facts.tags.length" class="mad-tags">
            <span v-for="t in facts.tags" :key="t" class="mad-tag">{{ t }}</span>
          </div>
          <p v-else class="mad-quiet">No tags</p>
          <p class="mad-hint">Tags are added in ComfyUI.</p>
        </section>

        <section class="mad-sec">
          <p class="mad-label">File</p>
          <dl class="mad-rows">
            <template v-for="[k, v] in fileRows" :key="k">
              <dt>{{ k }}</dt>
              <dd>{{ v }}</dd>
            </template>
          </dl>
        </section>

        <section class="mad-sec">
          <p class="mad-label">From the run</p>
          <div v-if="loading" class="mad-skel" aria-label="Loading">
            <i style="width: 90%" /><i style="width: 70%" /><i style="width: 50%" />
          </div>
          <template v-else-if="facts.prompt || facts.models.length">
            <div v-if="facts.prompt" class="mad-found">
              <p class="mad-found-k">
                Prompt <span>Found in {{ facts.promptNode }}</span>
              </p>
              <p class="mad-prompt">{{ facts.prompt }}</p>
            </div>
            <div class="mad-found">
              <p class="mad-found-k">Models <span>Referenced in the run</span></p>
              <p v-for="m in facts.models" :key="m" class="mad-model">{{ m }}</p>
              <p v-if="!facts.models.length" class="mad-quiet">Not identified</p>
            </div>
          </template>
          <p v-else class="mad-quiet">
            {{
              facts.imported
                ? 'Imported files carry no run.'
                : 'Not identified. The run’s data wasn’t kept.'
            }}
          </p>

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
  top: 16px;
  right: 16px;
  left: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
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
.mad-avail {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
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
