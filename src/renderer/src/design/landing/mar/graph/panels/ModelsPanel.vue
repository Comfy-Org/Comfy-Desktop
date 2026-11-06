<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronDown,
  CloudDownload,
  File,
  Folder,
  Pause,
  Play,
  RefreshCw,
  SearchX,
  XCircle
} from 'lucide-vue-next'
import RailPanel from './RailPanel.vue'
import { DOWNLOAD, MODEL_FOLDERS } from './panelData'
import MarSearchField from '../../pages/MarSearchField.vue'
import MarEmpty from '../../pages/MarEmpty.vue'

/**
 * Model Library on a local build (ComfyUI's ModelLibrarySidebarTab): the
 * models folder as a tree, one folder per kind; Desktop shows its
 * downloads in progress above it. (Comfy Cloud opens the Asset Browser
 * dialog instead: ModelBrowser.)
 */
const emit = defineEmits<{ close: [] }>()

const query = ref('')
const open = ref(new Set<string>(['checkpoints']))
const paused = ref(false)
const cancelled = ref(false)
function toggle(name: string): void {
  const s = new Set(open.value)
  if (s.has(name)) s.delete(name)
  else s.add(name)
  open.value = s
}
const folders = computed(() => {
  const q = query.value.trim().toLowerCase()
  return MODEL_FOLDERS.map((f) => ({
    ...f,
    models: q ? f.models.filter((m) => m.toLowerCase().includes(q)) : f.models
  })).filter((f) => !q || f.models.length)
})
</script>

<template>
  <RailPanel title="Model Library" @close="emit('close')">
    <template #tools>
      <button type="button" class="rp-icon" aria-label="Refresh" title="Refresh">
        <RefreshCw :size="14" />
      </button>
      <button type="button" class="rp-icon" aria-label="Load All Folders" title="Load All Folders">
        <CloudDownload :size="15" />
      </button>
    </template>
    <template #header>
      <MarSearchField v-model="query" placeholder="Search Models..." />
    </template>

    <!-- Desktop: what is downloading. -->
    <section v-if="!query" class="mp-downloads">
      <p class="mp-downloads-title">In Progress<span class="rp-count">1</span></p>
      <div class="mp-download">
        <p class="mp-file">{{ DOWNLOAD.file }}</p>
        <div class="mp-bar-row">
          <span class="mp-bar"
            ><i :style="{ width: `${DOWNLOAD.progress * 100}%` }" /><b
              >{{ Math.round(DOWNLOAD.progress * 100) }}%</b
            ></span
          >
          <template v-if="!cancelled">
            <button
              type="button"
              class="rp-icon mp-round"
              :aria-label="paused ? 'Resume Download' : 'Pause Download'"
              :title="paused ? 'Resume Download' : 'Pause Download'"
              @click="paused = !paused"
            >
              <Play v-if="paused" :size="12" /><Pause v-else :size="12" />
            </button>
            <button
              type="button"
              class="rp-icon mp-round is-danger"
              aria-label="Cancel Download"
              title="Cancel Download"
              @click="cancelled = true"
            >
              <XCircle :size="13" />
            </button>
          </template>
          <span v-else class="mp-chip">Cancelled</span>
        </div>
      </div>
    </section>

    <div class="rp-list">
      <template v-for="f in folders" :key="f.name">
        <button type="button" class="rp-row" @click="toggle(f.name)">
          <ChevronDown
            :size="14"
            class="rp-chev"
            :class="!open.has(f.name) && !query && 'is-shut'"
          />
          <Folder :size="14" class="rp-row-icon" /><span class="rp-row-text">{{ f.name }}</span>
          <span class="rp-count">{{ f.models.length }}</span>
        </button>
        <template v-if="open.has(f.name) || query">
          <button
            v-for="m in f.models"
            :key="m"
            type="button"
            class="rp-row mp-leaf"
            draggable="true"
            :title="m"
          >
            <File :size="14" class="rp-row-icon" /><span class="rp-row-text">{{
              m.replace(/\.(safetensors|pth|ckpt)$/, '')
            }}</span>
          </button>
        </template>
      </template>
    </div>
    <MarEmpty
      v-if="!folders.length"
      compact
      :icon="SearchX"
      title="No results"
      :text="`No models match “${query}”.`"
      action="Clear search"
      @action="query = ''"
    />
  </RailPanel>
</template>

<style>
/* What is downloading: the DS's raised panel. */
.mp-downloads {
  margin: 12px 12px 4px;
  padding: 10px 12px 12px;
  border-radius: var(--mar-tab-radius);
  background: var(--rp-raised);
  box-shadow: var(--rp-raised-shadow);
}
.mp-downloads-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
}
.mp-file {
  margin: 0 0 8px;
  overflow: hidden;
  color: var(--rp-text);
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.mp-bar-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.mp-bar {
  position: relative;
  display: flex;
  height: 16px;
  flex: 1;
  align-items: center;
  gap: 8px;
}
.mp-bar::before {
  position: absolute;
  top: 6px;
  right: 40px;
  left: 0;
  height: 4px;
  border-radius: 999px;
  background: var(--rp-chip-on);
  content: '';
}
.mp-bar i {
  position: absolute;
  top: 6px;
  left: 0;
  max-width: calc(100% - 40px);
  height: 4px;
  border-radius: 999px;
  background: #0b8ce9;
}
.mp-bar b {
  margin-left: auto;
  color: var(--rp-meta);
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .mp-round {
  width: 28px;
  height: 28px;
}
.mp-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, #e5484d 16%, transparent);
  color: #e5484d;
  font-size: 11px;
  font-weight: 500;
}
/* Files sit on a guide line under their folder. */
:root .proto-ui.proto-ui.proto-ui .rp-row.mp-leaf {
  width: calc(100% - 15px);
  margin-left: 15px;
  padding-left: 12px;
  border-radius: 0 var(--mar-tab-item-radius) var(--mar-tab-item-radius) 0;
  box-shadow: inset 1px 0 0 var(--rp-line);
  cursor: grab;
}
</style>
