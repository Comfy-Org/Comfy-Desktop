<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, Download, FolderOpen, Search, X } from 'lucide-vue-next'
import type { MissingModels } from './missingModels'
import { MISSING_MODELS_COPY as COPY, manualModels, modelFolder } from './missingModels'
import { fmtGb } from '../templateModal/templateData'
import ModelImportDialog from '../build/ModelImportDialog.vue'

const { missing } = defineProps<{ missing: MissingModels }>()
const emit = defineEmits<{ close: []; download: [] }>()

const total = computed(() => fmtGb(missing.models.reduce((n, m) => n + m.gb, 0)))

const finding = ref('')
const findOpen = computed({
  get: () => Boolean(finding.value),
  set: (v: boolean) => {
    if (!v) finding.value = ''
  }
})
const filePick = ref<HTMLInputElement>()
const picking = ref('')
function haveIt(name: string): void {
  picking.value = name
  filePick.value?.click()
}
function imported(name: string): void {
  if (name) manualModels.imported.add(name)
}
function onFile(): void {
  imported(picking.value)
  picking.value = ''
  if (filePick.value) filePick.value.value = ''
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || finding.value) return
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
      <button type="button" class="mmd-close" aria-label="Close" @click="emit('close')">
        <X :size="18" />
      </button>
      <header class="mmd-head">
        <h2 id="global-missing-models-warning" class="mmd-title">{{ COPY.title }}</h2>
      </header>
      <p class="mmd-desc">{{ COPY.description }}</p>
      <ul class="mmd-list">
        <li v-for="m in missing.models" :key="m.name" class="mmd-row">
          <span class="mmd-name" :title="m.name">{{ m.name }}</span>
          <span class="mmd-badge">{{ modelFolder(m.name) }}</span>
          <span class="mmd-size">{{ m.size }}</span>
        </li>
      </ul>
      <template v-if="missing.manual.length">
        <p class="mmd-desc">{{ COPY.notDownloadableHint }}</p>
        <ul class="mmd-list" data-missing-manual>
          <li v-for="m in missing.manual" :key="m.name" class="mmd-row">
            <span class="mmd-name" :title="m.name">{{ m.name }}</span>
            <span v-if="manualModels.imported.has(m.name)" class="mmd-ok"
              ><Check :size="13" />{{ COPY.imported }}</span
            >
            <template v-else>
              <span class="mmd-badge is-warn">{{ COPY.notDownloadable }}</span>
              <button type="button" class="rp-btn mmd-small" @click="finding = m.name">
                <Search :size="13" />{{ COPY.findIt }}
              </button>
              <button type="button" class="rp-btn mmd-small" @click="haveIt(m.name)">
                <FolderOpen :size="13" />{{ COPY.haveIt }}
              </button>
            </template>
          </li>
        </ul>
        <input
          ref="filePick"
          type="file"
          accept=".safetensors,.ckpt,.pth,.pt,.gguf"
          class="hidden"
          @change="onFile"
        />
      </template>
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
    <ModelImportDialog
      v-model="findOpen"
      :search="finding"
      @added="(imported(finding), (finding = ''))"
    />
  </div>
</template>

<style>
.rp-dialog.mmd {
  width: min(520px, 100%);
  height: auto;
  flex-direction: column;
  gap: 12px;
  position: relative;
  overflow: visible;
  padding: 20px 24px 16px;
}
:root .proto-ui.proto-ui.proto-ui .mmd-close {
  position: absolute;
  top: 0;
  right: -48px;
  z-index: 2;
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  background-color: var(--color-card-background);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  color: color-mix(in oklch, var(--color-base-foreground) 90%, transparent);
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mmd-close:hover {
  background-color: color-mix(
    in oklch,
    var(--color-base-foreground) 8%,
    var(--color-card-background)
  );
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mmd-close:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
.mmd-head {
  display: flex;
  align-items: center;
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
.mmd-badge.is-warn {
  background: color-mix(in oklch, var(--color-status-danger) 16%, transparent);
  color: var(--color-status-danger);
}
.mmd-ok {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  color: var(--color-status-running);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .rp-btn.mmd-small {
  height: 26px;
  flex: none;
  gap: 4px;
  padding: 0 8px;
  font-size: 12px;
}
.mmd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
</style>
