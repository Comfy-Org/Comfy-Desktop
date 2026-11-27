<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, CircleAlert, Download, FolderOpen, Search, X } from 'lucide-vue-next'
import type { MissingModels } from './missingModels'
import { MISSING_MODELS_COPY as COPY, manualModels, modelFolder } from './missingModels'
import { fmtGb } from '../templateModal/templateData'
import ModelImportDialog from '../build/ModelImportDialog.vue'

const { missing } = defineProps<{ missing: MissingModels }>()
const emit = defineEmits<{ close: []; download: [] }>()

const total = computed(() => fmtGb(missing.models.reduce((n, m) => n + m.gb, 0)))
const isImported = (name: string): boolean => manualModels.imported.has(name)
const waiting = computed(() => missing.manual.filter((m) => !isImported(m.name)).length)
const summary = computed(() => COPY.summary(missing.models.length + waiting.value))
const needsYouLabel = computed(() =>
  waiting.value ? `${COPY.needsYou} · ${waiting.value}` : COPY.needsYou
)

function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' }
}

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
      aria-describedby="global-missing-models-summary"
      data-missing-models
    >
      <header class="mmd-head">
        <div class="mmd-heading">
          <h2 id="global-missing-models-warning" class="mmd-title">{{ COPY.title }}</h2>
          <p id="global-missing-models-summary" class="mmd-summary">{{ summary }}</p>
        </div>
        <button type="button" class="rp-icon" aria-label="Close" @click="emit('close')">
          <X :size="16" />
        </button>
      </header>
      <div class="mmd-list">
        <section v-if="missing.models.length" class="mmd-group" data-missing-auto>
          <h3 class="rp-section mmd-label">{{ COPY.automatic }} · {{ total }}</h3>
          <ul class="mmd-rows">
            <li v-for="m in missing.models" :key="m.name" class="mmd-row">
              <span class="mmd-name" :title="m.name"
                ><span class="mmd-stem">{{ splitName(m.name).stem }}</span
                ><span class="mmd-ext">{{ splitName(m.name).ext }}</span></span
              >
              <span class="mmd-badge">{{ modelFolder(m.name) }}</span>
              <span class="mmd-size">{{ m.size }}</span>
            </li>
          </ul>
        </section>
        <section v-if="missing.manual.length" class="mmd-group" data-missing-manual>
          <h3 class="rp-section mmd-label">{{ needsYouLabel }}</h3>
          <ul class="mmd-rows">
            <li v-for="m in missing.manual" :key="m.name" class="mmd-row is-manual">
              <span class="mmd-what">
                <span class="mmd-name" :title="m.name"
                  ><span class="mmd-stem">{{ splitName(m.name).stem }}</span
                  ><span class="mmd-ext">{{ splitName(m.name).ext }}</span></span
                >
                <span v-if="!isImported(m.name)" class="mmd-why"
                  ><CircleAlert :size="12" class="mmd-why-icon" />{{ COPY.notOnKnownSite }}</span
                >
              </span>
              <span v-if="isImported(m.name)" class="mmd-ok"
                ><Check :size="14" />{{ COPY.imported }}</span
              >
              <span v-else class="mmd-tools">
                <button type="button" class="rp-btn mmd-small" @click="finding = m.name">
                  <Search :size="13" />{{ COPY.findIt }}
                </button>
                <button type="button" class="rp-btn mmd-small" @click="haveIt(m.name)">
                  <FolderOpen :size="13" />{{ COPY.haveIt }}
                </button>
              </span>
            </li>
          </ul>
          <input
            ref="filePick"
            type="file"
            accept=".safetensors,.ckpt,.pth,.pt,.gguf"
            class="hidden"
            @change="onFile"
          />
        </section>
      </div>
      <footer class="mmd-foot">
        <p v-if="waiting" class="mmd-note">{{ COPY.canvasNote }}</p>
        <span class="mmd-actions">
          <button type="button" class="rp-btn" @click="emit('close')">
            {{ COPY.openAnyway }}
          </button>
          <button
            v-if="missing.models.length"
            type="button"
            class="rp-btn is-inverted"
            data-missing-models-download
            @click="emit('download')"
          >
            <Download :size="14" />{{ COPY.download(total) }}
          </button>
        </span>
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
  width: min(580px, 100%);
  height: auto;
  flex-direction: column;
}
.mmd-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 14px 14px 24px;
}
.mmd-heading {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
}
.mmd-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
}
.mmd-summary {
  margin: 0;
  color: var(--rp-meta);
  font-size: 13px;
  line-height: 18px;
}
.mmd-list {
  display: flex;
  flex-direction: column;
  margin: 0 24px 20px;
  padding: 0 4px 4px;
  border-radius: var(--radius-control);
  background: var(--rp-chip);
}
:root .proto-ui.proto-ui.proto-ui .mmd-label {
  padding: 12px 8px 4px;
}
.mmd-rows {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.mmd-row {
  display: flex;
  min-height: 36px;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
}
.mmd-row.is-manual {
  min-height: 48px;
}
.mmd-what {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.mmd-name {
  display: flex;
  min-width: 0;
  flex: 1;
  white-space: nowrap;
}
.mmd-what .mmd-name {
  flex: none;
}
.mmd-stem {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mmd-ext {
  flex: none;
}
.mmd-why {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--rp-meta);
  font-size: 12px;
  line-height: 16px;
}
.mmd-why-icon {
  flex: none;
  color: var(--color-status-warning, #f5b14c);
}
.mmd-badge {
  flex: none;
  padding: 1px 6px;
  border-radius: var(--radius-control);
  background: var(--rp-chip-on);
  color: var(--rp-meta);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.mmd-size {
  flex: none;
  min-width: 52px;
  color: var(--rp-meta);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.mmd-tools {
  display: inline-flex;
  flex: none;
  gap: 6px;
}
:root .proto-ui.proto-ui.proto-ui .rp-btn.mmd-small {
  height: 26px;
  flex: none;
  gap: 4px;
  padding: 0 8px;
  font-size: 12px;
}
.mmd-ok {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  color: var(--rp-meta);
  font-size: 12px;
}
.mmd-ok svg {
  color: var(--color-status-running);
}
.mmd-foot {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 24px 16px;
  box-shadow: inset 0 1px 0 var(--rp-line);
}
.mmd-note {
  min-width: 0;
  flex: 1;
  margin: 0;
  color: var(--rp-meta);
  font-size: 12px;
  line-height: 16px;
}
.mmd-actions {
  display: inline-flex;
  flex: none;
  gap: 8px;
  margin-left: auto;
}
</style>
