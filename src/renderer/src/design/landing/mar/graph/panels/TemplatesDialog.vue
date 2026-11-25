<script setup lang="ts">
import { computed, ref } from 'vue'
import { AppWindow, ChevronDown, Flame, Handshake, Info, SearchX } from 'lucide-vue-next'
import GraphDialog from './GraphDialog.vue'
import MarEmpty from '../../pages/MarEmpty.vue'
import MarSeg from '../../pages/MarSeg.vue'
import MarSearchField from '../../pages/MarSearchField.vue'
import { TEMPLATES, thumb, type Template } from '../../../mock'
import { ComfyTemplate, ComfyWorkflow } from '../../icons/comfyIcons'
import { PICTURES } from './panelData'
import MediaChip from '../../MediaChip.vue'

/**
 * Templates (ComfyUI's WorkflowTemplateSelectorDialog, from the rail's
 * Templates button): categories on the left; search; All, Node graph or
 * App, with the model, task and runs-on filters and a sort; the cards.
 */
const emit = defineEmits<{ close: []; pick: [t: Template] }>()

const GROUPS: { title: string; items: { label: string; category?: Template['category'] }[] }[] = [
  { title: 'Basics', items: [{ label: 'Getting Started' }] },
  {
    title: 'Generation Type',
    items: [
      { label: 'Image', category: 'image' },
      { label: 'Video', category: 'video' },
      { label: 'Audio', category: 'audio' },
      { label: '3D', category: '3d' }
    ]
  }
]
const nav = ref('All Templates')
const query = ref('')
const type = ref<'All' | 'Node graph' | 'App'>('All')
const TYPES = (['All', 'Node graph', 'App'] as const).map((t) => ({ value: t, label: t }))
const category = computed(
  () => GROUPS.flatMap((g) => g.items).find((i) => i.label === nav.value)?.category
)
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return TEMPLATES.filter(
    (t) =>
      (!category.value || t.category === category.value) &&
      (nav.value !== 'Partner Nodes' || t.runs === 'cloud') &&
      (type.value === 'All' || (type.value === 'App' ? t.kind === 'app' : t.kind === 'graph')) &&
      (!q || t.title.toLowerCase().includes(q))
  )
})
/** A thumbnail that does not load (offline): one of ours instead. */
function fallback(e: Event, i: number): void {
  const img = e.target as HTMLImageElement
  const alt = PICTURES[i % PICTURES.length]?.src
  if (alt && img.src !== alt) img.src = alt
}
const CAT: Record<Template['category'], string> = {
  image: 'Image',
  video: 'Video',
  '3d': '3D',
  audio: 'Audio'
}
</script>

<template>
  <GraphDialog title="Templates" @close="emit('close')">
    <template #icon><ComfyTemplate :size="16" /></template>
    <template #nav>
      <button
        type="button"
        class="rp-row"
        :class="nav === 'All Templates' && 'is-on'"
        @click="nav = 'All Templates'"
      >
        All Templates
      </button>
      <button
        type="button"
        class="rp-row"
        :class="nav === 'Popular' && 'is-on'"
        @click="nav = 'Popular'"
      >
        <Flame :size="14" class="rp-row-icon" />Popular
      </button>
      <template v-for="g in GROUPS" :key="g.title">
        <p class="rp-dialog-group">{{ g.title }}</p>
        <button
          v-for="i in g.items"
          :key="i.label"
          type="button"
          class="rp-row"
          :class="nav === i.label && 'is-on'"
          @click="nav = i.label"
        >
          {{ i.label }}
        </button>
      </template>
      <span class="rp-menu-sep" />
      <button
        type="button"
        class="rp-row"
        :class="nav === 'Partner Nodes' && 'is-on'"
        @click="nav = 'Partner Nodes'"
      >
        <Handshake :size="14" class="rp-row-icon" />Partner Nodes
      </button>
    </template>
    <template #header>
      <MarSearchField v-model="query" placeholder="Search ..." />
    </template>

    <h2 class="rp-title-lg">Get Started with a Template</h2>
    <div class="rp-filters">
      <MarSeg v-model="type" :options="TYPES" label="Template type" />
      <span class="rp-spacer" />
      <button type="button" class="rp-btn">Model Filter<ChevronDown :size="13" /></button>
      <button type="button" class="rp-btn">Tasks<ChevronDown :size="13" /></button>
      <button type="button" class="rp-btn">Runs on<ChevronDown :size="13" /></button>
      <button type="button" class="rp-btn">Sort by: Default<ChevronDown :size="13" /></button>
    </div>

    <div v-if="shown.length" class="td-grid">
      <article v-for="(t, i) in shown" :key="t.id" class="td-card" @click="emit('pick', t)">
        <span class="td-media">
          <img :src="thumb(t.id)" alt="" loading="lazy" @error="fallback($event, i)" />
          <span class="td-chip"
            ><MediaChip :icon="t.kind === 'app' ? AppWindow : ComfyWorkflow">{{
              t.kind === 'app' ? 'App' : 'Node graph'
            }}</MediaChip></span
          >
          <button type="button" class="rp-icon td-info" aria-label="See a tutorial" @click.stop>
            <Info :size="14" />
          </button>
        </span>
        <p class="td-title">{{ t.title }}</p>
        <span class="td-tags">
          <span class="td-tag">{{ CAT[t.category] }}</span>
          <span v-if="t.runs === 'cloud'" class="td-tag">API</span>
          <span v-if="t.vram" class="td-tag">{{ t.vram }}</span>
        </span>
      </article>
    </div>
    <MarEmpty
      v-else
      compact
      :icon="SearchX"
      title="No templates found"
      text="Try adjusting your search or filters"
      action="Clear filters"
      @action="((query = ''), (type = 'All'), (nav = 'All Templates'))"
    />
    <template #footer>
      <p class="rp-dialog-foot">Showing {{ shown.length }} of {{ TEMPLATES.length }} templates</p>
    </template>
  </GraphDialog>
</template>

<style>
.td-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.td-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: var(--mar-tab-radius);
  cursor: pointer;
}
.td-card:hover {
  background: var(--rp-chip);
}
.td-media {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: var(--mar-tab-radius);
  background: var(--rp-chip);
}
.td-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.td-chip {
  position: absolute;
  top: 8px;
  left: 8px;
}
:root .proto-ui.proto-ui.proto-ui .td-info {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  background: rgb(0 0 0 / 0.55);
  color: #fff;
  opacity: 0;
}
.td-card:hover .td-info {
  opacity: 1;
}
.td-title {
  margin: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.td-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.td-tag {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--rp-chip);
  color: var(--rp-meta);
  font-size: 11px;
}
</style>
