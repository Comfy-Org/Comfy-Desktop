<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePreferredReducedMotion, useTransition } from '@vueuse/core'
import { CircleCheck, HardDrive, RotateCcw, TriangleAlert } from 'lucide-vue-next'
import { instanceById } from '../../useProto'
import { modelsState } from '../build/models'
import { fmtGb } from '../templateModal/templateData'
import {
  OTHER_DRIVE,
  THIS_DRIVE,
  diskNeedGb,
  diskRoom,
  retry,
  type TemplateDownload
} from './templateDownloads'

const props = defineProps<{ download: TemplateDownload; buildId: string }>()

const listOpen = ref(false)
const short = computed(() => diskNeedGb(props.download))
const roomy = computed(() => short.value <= 0)
const reduced = usePreferredReducedMotion()
const shortShown = useTransition(short, {
  duration: 420,
  disabled: computed(() => reduced.value === 'reduce')
})

const gbUp = (gb: number): string => `${(Math.ceil(Math.max(0, gb) * 10) / 10).toFixed(1)} GB`

const line = computed(() => {
  if (!roomy.value) return `Needs ${gbUp(short.value)} more on ${THIS_DRIVE.name}`
  if (diskRoom.otherDrive)
    return `Downloads to ${OTHER_DRIVE.name}, ${(OTHER_DRIVE.freeGb / 1000).toFixed(1)} TB free`
  return `${fmtGb(diskRoom.freedGb)} freed on ${THIS_DRIVE.name}`
})

const rows = computed(() =>
  modelsState.models
    .filter(
      (m) => (m.installed || diskRoom.removed.includes(m.id)) && !m.usedBy.includes(props.buildId)
    )
    .sort(
      (a, b) => Number(b.usedBy.length === 0) - Number(a.usedBy.length === 0) || b.sizeGb - a.sizeGb
    )
)

const usedByLine = (ids: string[]): string =>
  ids.length
    ? `Only in ${ids.map((id) => instanceById(id)?.name ?? id).join(', ')}`
    : 'Not used by any workflow'

function removeModel(id: string): void {
  const m = modelsState.models.find((x) => x.id === id)
  if (!m || !m.installed) return
  m.installed = false
  diskRoom.removed.push(m.id)
  diskRoom.freedGb += m.sizeGb
}

function chooseDrive(): void {
  diskRoom.otherDrive = true
  listOpen.value = false
}
</script>

<template>
  <div
    class="mar-tpl-disk"
    :data-tone="roomy ? 'ok' : 'warn'"
    role="status"
    aria-live="polite"
    data-edge-disk
  >
    <div class="mar-tpl-disk-head">
      <CircleCheck v-if="roomy" :size="16" class="mar-tpl-disk-icon" />
      <TriangleAlert v-else :size="16" class="mar-tpl-disk-icon" />
      <span class="grid min-w-0">
        <span class="mar-tpl-disk-title">{{
          roomy ? 'Enough space now' : 'Not enough space'
        }}</span>
        <span class="mar-tpl-disk-line">{{ line }}</span>
      </span>
    </div>
    <div v-if="listOpen && !roomy" class="mar-tpl-disk-list" data-edge-space-list>
      <div class="mar-tpl-disk-list-head">
        <span class="mad-label">Unused models</span>
        <span class="mar-tpl-disk-togo" data-edge-togo>{{ gbUp(shortShown) }} to go</span>
      </div>
      <ul>
        <li v-for="m in rows" :key="m.id" :data-removed="!m.installed || undefined">
          <span class="grid min-w-0">
            <span class="mar-tpl-disk-name" :title="m.file">{{ m.name }}</span>
            <span class="mar-tpl-disk-meta">{{ usedByLine(m.usedBy) }}</span>
          </span>
          <span class="mar-tpl-disk-size">{{ fmtGb(m.sizeGb) }}</span>
          <button
            v-if="m.installed"
            type="button"
            class="mar-tpl-disk-remove"
            data-edge-remove
            @click="removeModel(m.id)"
          >
            Remove
          </button>
          <span v-else class="mar-tpl-disk-removed">Removed</span>
        </li>
      </ul>
    </div>
    <div v-if="!roomy" class="mar-tpl-disk-acts">
      <button
        type="button"
        class="mad-btn"
        data-edge-space
        :aria-expanded="listOpen"
        @click="listOpen = !listOpen"
      >
        <span>Free up space</span>
      </button>
      <button type="button" class="mad-btn is-primary" data-edge-drive @click="chooseDrive">
        <HardDrive :size="15" />
        <span>Choose another drive</span>
      </button>
    </div>
  </div>
  <button
    v-if="roomy"
    type="button"
    class="mad-btn is-primary mar-tpl-go"
    data-tpl-primary
    data-download-action="failed"
    @click="retry(download.id)"
  >
    <RotateCcw :size="14" class="relative shrink-0" />
    <span>Try again</span>
  </button>
</template>
