<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, ScanSearch, X } from 'lucide-vue-next'
import type { MarAsset } from '../pages/assetsStore'
import { factsFor } from '../assets/assetFacts'
import { addTag, removeTag, tagsOf } from '../assets/assetTags'

/**
 * Asset details on the right of the canvas (Media Assets › Show details),
 * so the graph stays in view. One asset: its picture, file facts, tags
 * you can edit and how it was made. Several: how many, and the tags they
 * all share, added to or taken off all of them at once.
 */
type SideAsset = MarAsset & { src: string; seconds: number; kind: string }
const { assets } = defineProps<{ assets: SideAsset[] }>()
const emit = defineEmits<{ close: []; inspect: [asset: SideAsset] }>()

const one = computed(() => (assets.length === 1 ? assets[0]! : null))
const facts = computed(() => (one.value ? factsFor(one.value) : null))
const rows = computed(() => {
  const a = one.value
  const f = facts.value
  if (!a || !f) return []
  return [
    ['Type', f.format],
    ['Dimensions', f.width ? `${f.width} × ${f.height}` : f.duration],
    ['Size', a.size],
    a.kind === 'Generated' ? ['Run time', `${a.seconds.toFixed(1)}s`] : null,
    ['Added', a.when]
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
        <div v-if="one && one.kind === 'Generated' && facts" class="ap-side-sec">
          <p class="rp-menu-label">Generation details</p>
          <p v-if="facts.prompt" class="ap-side-prompt">{{ facts.prompt }}</p>
          <p v-for="m in facts.models" :key="m" class="ap-side-model">{{ m }}</p>
          <p v-if="!facts.prompt && !facts.models.length" class="ap-side-hint">
            No run data in this file.
          </p>
        </div>
      </template>
    </div>
    <footer v-if="one" class="ap-side-foot">
      <button type="button" class="ap-side-btn" @click="emit('inspect', one)">
        <ScanSearch :size="14" />Inspect asset
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
.ap-side-prompt {
  max-height: 8.5em;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.5;
}
.ap-side-model {
  overflow: hidden;
  color: var(--rp-meta);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ap-side-foot {
  display: flex;
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
:root .proto-ui.proto-ui.proto-ui .ap-side-btn:hover {
  background: var(--rp-chip-on);
}
</style>
