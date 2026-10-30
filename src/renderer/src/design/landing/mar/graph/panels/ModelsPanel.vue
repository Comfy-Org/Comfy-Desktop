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
  Search,
  XCircle
} from 'lucide-vue-next'
import RailPanel from './RailPanel.vue'
import { DOWNLOAD, MODEL_FOLDERS } from './panelData'

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
      <div class="rp-top">
        <label class="rp-search">
          <Search :size="14" />
          <input v-model="query" type="search" placeholder="Search Models..." />
        </label>
      </div>
    </template>

    <!-- Desktop: what is downloading. -->
    <section v-if="!query" class="mp-downloads">
      <p class="mp-downloads-title">In Progress</p>
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
              class="rp-icon is-filled mp-round"
              :aria-label="paused ? 'Resume Download' : 'Pause Download'"
              :title="paused ? 'Resume Download' : 'Pause Download'"
              @click="paused = !paused"
            >
              <Play v-if="paused" :size="12" /><Pause v-else :size="12" />
            </button>
            <button
              type="button"
              class="rp-icon is-filled mp-round is-danger"
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
      <p v-if="!folders.length" class="rp-empty">No models match “{{ query }}”.</p>
    </div>
  </RailPanel>
</template>

<style>
.mp-downloads {
  margin: 4px 16px 12px;
  padding: 12px;
  border-radius: var(--mar-tab-radius);
  background: var(--rp-chip);
}
.mp-downloads-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
}
.mp-file {
  margin: 0 0 6px;
  overflow: hidden;
  color: var(--mg-muted);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.mp-bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mp-bar {
  position: relative;
  height: 20px;
  flex: 1;
  overflow: hidden;
  border-radius: 6px;
  background: var(--rp-chip-on);
}
.mp-bar i {
  position: absolute;
  inset: 0 auto 0 0;
  background: #0b8ce9;
}
.mp-bar b {
  position: relative;
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .mp-round {
  width: 26px;
  height: 26px;
  border-radius: 999px;
}
.mp-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, #e5484d 20%, transparent);
  color: #e5484d;
  font-size: 11px;
}
:root .proto-ui.proto-ui.proto-ui .rp-row.mp-leaf {
  padding-left: 30px;
  cursor: grab;
}
</style>
