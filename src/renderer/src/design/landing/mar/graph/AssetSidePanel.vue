<script setup lang="ts">
import { computed, ref } from 'vue'
import { AppWindow, Download, Maximize2, Plus, Workflow, X } from 'lucide-vue-next'
import { toast } from '../../useProto'
import GenerationInfo from '../assets/GenerationInfo.vue'
import type { MarAsset } from '../pages/assetsStore'
import { factsFor } from '../assets/assetFacts'
import { saveFile } from '../assets/saveFile'
import { addTag, removeTag, tagsOf } from '../assets/assetTags'

/**
 * Asset details on the right of the canvas (Media Assets › Show details),
 * so the graph stays in view. One asset: its picture, file facts, tags
 * you can edit, how it was made (GenerationInfo, as in Desktop's asset
 * view) and what to do with it. Several: how many, and the tags they
 * all share, added to or taken off all of them at once.
 */
type SideAsset = MarAsset & { src: string; seconds: number; kind: string }
const { assets, openLabel = 'Open full view' } = defineProps<{
  assets: SideAsset[]
  /** This panel is Inspect asset; its button opens the full view, in a new
   *  tab where ComfyUI shows workflow tabs. */
  openLabel?: string
}>()
const emit = defineEmits<{ close: []; inspect: [asset: SideAsset] }>()

const one = computed(() => (assets.length === 1 ? assets[0]! : null))
/** An imported file carries no run, whatever its name suggests. */
const facts = computed(() => {
  const a = one.value
  if (!a) return null
  const f = factsFor(a)
  return a.kind === 'Generated'
    ? f
    : {
        ...f,
        imported: true,
        workflow: 'missing' as const,
        history: 'missing' as const,
        prompt: undefined,
        negative: undefined,
        params: undefined,
        models: [],
        json: undefined
      }
})
const rows = computed(() => {
  const a = one.value
  const f = facts.value
  if (!a || !f) return []
  return [
    ['Type', f.format],
    ['Dimensions', f.width ? `${f.width} × ${f.height}` : f.duration],
    ['Size', a.size],
    a.kind === 'Generated' ? ['Run time', `${a.seconds.toFixed(1)}s`] : null,
    [a.kind === 'Generated' ? 'Created' : 'Imported', a.when]
  ].filter((r): r is [string, string] => !!r && !!r[1])
})
/** The tags every asset in view has; one asset shows all of its own. */
const shared = computed(() => {
  const [first, ...rest] = assets
  if (!first) return []
  return tagsOf(first).filter((t) => rest.every((a) => tagsOf(a).includes(t)))
})
const draft = ref('')
function add(): void {
  if (!draft.value.trim()) return
  for (const a of assets) addTag(a, draft.value)
  draft.value = ''
}
function drop(t: string): void {
  for (const a of assets) removeTag(a, t)
}
</script>

<template>
  <aside class="rp ap-side" aria-label="Asset details" @pointerdown.stop @wheel.stop>
    <header class="rp-head">
      <h2 class="rp-title">Asset details</h2>
      <span class="rp-tools" />
      <button
        type="button"
        class="rp-icon rp-close"
        aria-label="Close asset details"
        title="Close"
        @click="emit('close')"
      >
        <X :size="15" />
      </button>
    </header>
    <div class="rp-body">
      <p v-if="!assets.length" class="ap-side-empty">Select an asset to see its details.</p>
      <template v-else>
        <div class="ap-side-hero" :class="!one && 'is-stack'">
          <img
            v-for="(a, i) in assets.slice(0, one ? 1 : 3)"
            :key="a.id"
            :src="a.src"
            alt=""
            :style="!one ? { '--i': i } : undefined"
          />
        </div>
        <div class="ap-side-sec">
          <p class="ap-side-name">{{ one ? one.name : `${assets.length} assets selected` }}</p>
          <dl v-if="one" class="ap-side-rows">
            <div v-for="[k, v] in rows" :key="k">
              <dt>{{ k }}</dt>
              <dd>{{ v }}</dd>
            </div>
          </dl>
        </div>
        <div class="ap-side-sec">
          <p class="rp-menu-label">Tags</p>
          <div class="ap-side-tags">
            <span v-for="t in shared" :key="t" class="ap-side-tag"
              >{{ t
              }}<button type="button" :aria-label="`Remove ${t}`" @click="drop(t)">
                <X :size="11" /></button
            ></span>
            <label class="ap-side-add">
              <Plus :size="12" />
              <input
                v-model="draft"
                :placeholder="one ? 'Add tag' : 'Add to all'"
                aria-label="Add a tag"
                @keydown.enter.prevent="add"
              />
            </label>
          </div>
          <p v-if="!one && !shared.length" class="ap-side-hint">No tag is on all of them yet.</p>
        </div>
        <div v-if="one && facts" class="ap-side-sec">
          <p class="rp-menu-label">Generation info</p>
          <GenerationInfo :facts="facts" />
        </div>
      </template>
    </div>
    <footer v-if="one" class="ap-side-foot">
      <button type="button" class="ap-side-btn is-main" @click="emit('inspect', one)">
        <AppWindow v-if="openLabel === 'Open in new tab'" :size="14" /><Maximize2
          v-else
          :size="14"
        />{{ openLabel }}
      </button>
      <button
        v-if="facts?.workflow === 'available'"
        type="button"
        class="ap-side-btn is-icon"
        aria-label="Open as workflow in new tab"
        title="Open as workflow in new tab"
        @click="toast(`Opened ${one.name} as a workflow`)"
      >
        <Workflow :size="14" />
      </button>
      <button
        type="button"
        class="ap-side-btn is-icon"
        aria-label="Download"
        title="Download"
        @click="saveFile(one.src, one.name)"
      >
        <Download :size="14" />
      </button>
    </footer>
  </aside>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .rp.ap-side {
  /* Under the Run bar, which holds the top right. */
  top: calc(var(--mg-top) + 64px);
  right: 16px;
  left: auto;
  width: 300px;
}
/* Current look: the Run bar sits lower, under ComfyUI's top bar. */
:root .proto-ui.proto-ui.proto-ui .mg.is-current > .rp.ap-side {
  top: calc(var(--mg-top) + 38px + 64px);
}
.ap-side-empty {
  padding: 24px 16px;
  color: var(--rp-meta);
  font-size: 13px;
  text-align: center;
}
.ap-side-hero {
  display: grid;
  place-items: center;
  margin: 12px 16px 4px;
}
.ap-side-hero img {
  max-height: 220px;
  border-radius: 8px;
  object-fit: contain;
}
.ap-side-hero.is-stack {
  height: 132px;
}
.ap-side-hero.is-stack img {
  grid-area: 1 / 1;
  width: 104px;
  height: 104px;
  object-fit: cover;
  box-shadow: 0 6px 16px rgb(0 0 0 / 0.35);
  rotate: calc((var(--i) - 1) * 7deg);
  translate: calc((var(--i) - 1) * 14px) 0;
}
.ap-side-sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--rp-line);
}
.ap-side-sec:first-of-type {
  border-top: 0;
}
.ap-side-name {
  overflow-wrap: anywhere;
  font-size: 14px;
  font-weight: 600;
}
.ap-side-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
.ap-side-rows div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.ap-side-rows dt {
  color: var(--rp-meta);
}
.ap-side-rows dd {
  font-variant-numeric: tabular-nums;
}
.ap-side-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ap-side-tag {
  display: inline-flex;
  height: 24px;
  align-items: center;
  gap: 2px;
  padding: 0 4px 0 9px;
  border-radius: 999px;
  background: var(--rp-chip);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .ap-side-tag button {
  display: inline-flex;
  padding: 2px;
  border-radius: 999px;
  background: transparent;
  color: var(--rp-meta);
}
:root .proto-ui.proto-ui.proto-ui .ap-side-tag button:hover {
  background: var(--rp-hover);
  color: var(--rp-text);
}
.ap-side-add {
  display: inline-flex;
  height: 24px;
  flex: 0 1 112px;
  min-width: 0;
  align-items: center;
  gap: 4px;
  padding: 0 9px;
  border-radius: 999px;
  color: var(--rp-meta);
  cursor: text;
}
.ap-side-add:hover,
.ap-side-add:focus-within {
  background: var(--rp-hover);
  color: var(--rp-text);
}
:root .proto-ui.proto-ui.proto-ui .ap-side-add input {
  min-width: 0;
  flex: 1;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 12px;
  outline: none;
}
.ap-side-hint {
  color: var(--rp-meta);
  font-size: 12px;
}
.ap-side-foot {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--rp-line);
}
:root .proto-ui.proto-ui.proto-ui .ap-side-btn {
  display: inline-flex;
  height: 32px;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  background: var(--rp-chip);
  color: var(--rp-text);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui .ap-side-btn.is-icon {
  width: 32px;
  flex: none;
}
:root .proto-ui.proto-ui.proto-ui .ap-side-btn:hover {
  background: var(--rp-chip-on);
}
</style>
