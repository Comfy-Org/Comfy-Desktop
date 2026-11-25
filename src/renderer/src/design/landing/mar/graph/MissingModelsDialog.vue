<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { Download, X } from 'lucide-vue-next'
import type { MissingModels } from './missingModels'
import { MISSING_MODELS_COPY as COPY, modelFolder } from './missingModels'
import { fmtGb } from '../templateModal/templateData'

const { missing } = defineProps<{ missing: MissingModels }>()
const emit = defineEmits<{ close: []; download: [] }>()

const total = computed(() => fmtGb(missing.models.reduce((n, m) => n + m.gb, 0)))

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div class="rp-scrim" @pointerdown.self="emit('close')" @wheel.stop>
    <section
      class="rp-dialog mmd"
      role="dialog"
      aria-labelledby="global-missing-models-warning"
      data-missing-models
    >
      <header class="mmd-head">
        <h2 id="global-missing-models-warning" class="mmd-title">{{ COPY.title }}</h2>
        <button type="button" class="rp-icon" aria-label="Close" @click="emit('close')">
          <X :size="16" />
        </button>
      </header>
      <p class="mmd-desc">{{ COPY.description }}</p>
      <ul class="mmd-list">
        <li v-for="m in missing.models" :key="m.name" class="mmd-row">
          <span class="mmd-name" :title="m.name">{{ m.name }}</span>
          <span class="mmd-badge">{{ modelFolder(m.name) }}</span>
          <span class="mmd-size">{{ m.size }}</span>
        </li>
      </ul>
      <p class="mmd-total">
        {{ COPY.totalSize }} <strong>{{ total }}</strong>
      </p>
      <p class="mmd-foot-note">{{ COPY.footer }}</p>
      <footer class="mmd-actions">
        <button type="button" class="rp-btn" @click="emit('close')">{{ COPY.gotIt }}</button>
        <button
          type="button"
          class="rp-btn is-inverted"
          data-missing-models-download
          @click="emit('download')"
        >
          <Download :size="14" />{{ COPY.downloadAll }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style>
.rp-dialog.mmd {
  width: min(520px, 100%);
  height: auto;
  flex-direction: column;
  gap: 12px;
  padding: 20px 20px 16px 24px;
}
.mmd-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mmd-head > .rp-icon {
  margin-left: auto;
}
.mmd-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.mmd-desc,
.mmd-total,
.mmd-foot-note {
  margin: 0;
  color: var(--rp-meta);
  font-size: 13px;
  line-height: 18px;
}
.mmd-foot-note {
  font-size: 12px;
  white-space: pre-line;
}
.mmd-total strong {
  color: var(--rp-text);
  font-weight: 600;
}
.mmd-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  border-radius: var(--radius-control);
  background: var(--rp-chip);
}
.mmd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}
.mmd-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mmd-badge {
  flex: none;
  padding: 1px 8px;
  border-radius: var(--radius-control);
  background: var(--rp-chip-on);
  color: var(--rp-meta);
  font-size: 10.5px;
  font-weight: 600;
}
.mmd-size {
  flex: none;
  min-width: 56px;
  color: var(--rp-meta);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.mmd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
</style>
