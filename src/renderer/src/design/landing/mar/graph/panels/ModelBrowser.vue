<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowUpDown,
  ChevronDown,
  Ellipsis,
  FolderInput,
  Info,
  List,
  Search
} from 'lucide-vue-next'
import GraphDialog from './GraphDialog.vue'
import { CLOUD_MODELS, CLOUD_MODEL_TYPES, type CloudModel } from './panelData'
import { ComfyModel } from '../../icons/comfyIcons'

/**
 * Model Library on Comfy Cloud (ComfyUI's AssetBrowserModal): All Models,
 * Imported and the model types on the left; search and Import; filters by
 * file format, base model and ownership, a sort; cards to Use; the
 * selected model's info on the right.
 */
const emit = defineEmits<{ close: [] }>()

const nav = ref('All Models')
const query = ref('')
const picked = ref<CloudModel>()
const sort = ref('Recent')
const sortOpen = ref(false)
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = CLOUD_MODELS.filter(
    (m) =>
      (nav.value === 'All Models' ||
        (nav.value === 'Imported' ? m.imported : m.type === nav.value)) &&
      (!q || `${m.name} ${m.base}`.toLowerCase().includes(q))
  )
  if (sort.value === 'A-Z') return [...list].sort((a, b) => a.name.localeCompare(b.name))
  if (sort.value === 'Z-A') return [...list].sort((a, b) => b.name.localeCompare(a.name))
  return list
})
</script>

<template>
  <GraphDialog title="Model Library" @close="emit('close')">
    <template #icon><ComfyModel :size="16" /></template>
    <template #nav>
      <button
        type="button"
        class="rp-row"
        :class="nav === 'All Models' && 'is-on'"
        @click="nav = 'All Models'"
      >
        <List :size="14" class="rp-row-icon" />All Models
      </button>
      <button
        type="button"
        class="rp-row"
        :class="nav === 'Imported' && 'is-on'"
        @click="nav = 'Imported'"
      >
        <FolderInput :size="14" class="rp-row-icon" />Imported
      </button>
      <p class="rp-dialog-group">By type</p>
      <button
        v-for="t in CLOUD_MODEL_TYPES"
        :key="t"
        type="button"
        class="rp-row"
        :class="nav === t && 'is-on'"
        @click="nav = t"
      >
        {{ t }}
      </button>
    </template>
    <template #header>
      <label class="rp-search">
        <Search :size="15" />
        <input v-model="query" type="search" placeholder="Search ..." aria-label="Search models" />
      </label>
      <button type="button" class="rp-btn is-primary"><FolderInput :size="14" />Import</button>
    </template>

    <div class="rp-filters">
      <button type="button" class="rp-btn">File formats<ChevronDown :size="13" /></button>
      <button type="button" class="rp-btn">Base models<ChevronDown :size="13" /></button>
      <button type="button" class="rp-btn">Ownership<ChevronDown :size="13" /></button>
      <span class="rp-spacer" />
      <span class="rp-anchor">
        <button type="button" class="rp-btn" @click="sortOpen = !sortOpen">
          <ArrowUpDown :size="13" />Sort by: {{ sort }}
        </button>
        <div v-if="sortOpen" class="rp-menu is-end">
          <button
            v-for="o in ['Recent', 'A-Z', 'Z-A']"
            :key="o"
            type="button"
            class="rp-row"
            :class="sort === o && 'is-on'"
            @click="((sort = o), (sortOpen = false))"
          >
            {{ o }}
          </button>
        </div>
      </span>
    </div>
    <div v-if="shown.length" class="mb-grid">
      <article
        v-for="m in shown"
        :key="m.name"
        class="mb-card"
        :class="picked === m && 'is-on'"
        @click="picked = m"
      >
        <span class="mb-media">
          <img :src="m.src" alt="" />
          <span class="mb-badge">{{ m.base }}</span>
          <span class="mb-hover">
            <button type="button" class="rp-icon is-filled" aria-label="Model Info">
              <Info :size="14" />
            </button>
            <button type="button" class="rp-icon is-filled" aria-label="More">
              <Ellipsis :size="14" />
            </button>
          </span>
        </span>
        <p class="mb-title">{{ m.name }}</p>
        <p class="mb-sub">{{ m.type }} · .{{ m.format }}</p>
        <button type="button" class="rp-btn mb-use">
          Use<i v-if="m.imported" class="rp-dot" />
        </button>
      </article>
    </div>
    <p v-else class="rp-empty">
      {{
        nav === 'Imported'
          ? 'No imported models yet. Click "Import" to add your own.'
          : 'Try adjusting your search or filters.'
      }}<br v-if="nav !== 'Imported'" /><template v-if="nav !== 'Imported'"
        >You can also add models using the "Import" button above.</template
      >
    </p>

    <template #info>
      <p class="mb-info-title">Model Info</p>
      <template v-if="picked">
        <img :src="picked.src" alt="" class="mb-info-img" />
        <p class="mb-title">{{ picked.name }}</p>
        <dl class="mb-meta">
          <dt>Type</dt>
          <dd>{{ picked.type }}</dd>
          <dt>Base model</dt>
          <dd>{{ picked.base }}</dd>
          <dt>Format</dt>
          <dd>.{{ picked.format }}</dd>
        </dl>
      </template>
      <p v-else class="rp-note mb-info-empty">Select a model to see its information</p>
    </template>
  </GraphDialog>
</template>

<style>
.mb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 16px;
}
.mb-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: var(--mar-tab-radius);
  cursor: pointer;
}
.mb-card:hover,
.mb-card.is-on {
  background: var(--rp-chip);
}
.mb-media {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: var(--mar-tab-radius);
}
.mb-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mb-badge {
  position: absolute;
  bottom: 8px;
  left: 8px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgb(0 0 0 / 0.55);
  color: #fff;
  font-size: 11px;
}
.mb-hover {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 4px;
  opacity: 0;
}
.mb-card:hover .mb-hover {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .mb-hover .rp-icon {
  background: rgb(0 0 0 / 0.55);
  color: #fff;
}
.mb-title {
  margin: 4px 0 0;
  font-size: 13px;
  font-weight: 600;
}
.mb-sub {
  margin: 0;
  color: var(--mg-dim);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mb-use {
  position: relative;
  justify-content: center;
  margin-top: 6px;
}
.mb-info-title {
  margin: 0 0 14px;
  font-size: 14px;
  font-weight: 600;
}
.mb-info-img {
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--mar-tab-radius);
  object-fit: cover;
}
.mb-info-empty {
  padding: 0;
}
.mb-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 12px;
  margin: 12px 0 0;
  font-size: 12px;
}
.mb-meta dt {
  color: var(--mg-dim);
}
.mb-meta dd {
  margin: 0;
}
</style>
