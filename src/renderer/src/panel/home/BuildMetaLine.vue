<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'

const { text, buildName, showUpdate } = defineProps<{
  text: string
  buildName: string
  showUpdate: boolean
}>()

const emit = defineEmits<{ 'open-update': [] }>()

const { t } = useI18n()

const lineEl = useTemplateRef<HTMLElement>('line')
const textEl = useTemplateRef<HTMLElement>('text')
const fullNoteEl = useTemplateRef<HTMLElement>('fullNote')
const shortLabel = ref(false)

function fitNote(): void {
  const line = lineEl.value
  const fullNote = fullNoteEl.value
  if (!line || !fullNote) {
    shortLabel.value = false
    return
  }
  const textWidth = textEl.value?.scrollWidth ?? 0
  shortLabel.value = textWidth + fullNote.getBoundingClientRect().width > line.clientWidth + 0.5
}

useResizeObserver(lineEl, fitNote)
watch(
  () => [text, showUpdate],
  () => void nextTick(fitNote),
  { flush: 'post' }
)

function openUpdate(): void {
  emit('open-update')
}
</script>

<template>
  <span ref="line" class="relative flex min-w-0 text-xs/[17px] text-subtle-foreground">
    <span v-if="text" ref="text" class="min-w-0 truncate">{{ text }}</span>
    <template v-if="showUpdate">
      <span
        ref="fullNote"
        class="pointer-events-none invisible absolute top-0 right-0 whitespace-pre before:content-[attr(data-separator)] after:content-[attr(data-label)]"
        :data-separator="text ? ' · ' : ''"
        :data-label="t('chooser.updateAvailable')"
        aria-hidden="true"
        data-testid="build-update-note-sizer"
      />
      <span
        class="flex shrink-0 items-center whitespace-pre"
        :data-short="shortLabel ? 'true' : undefined"
        data-testid="build-update-note"
        >{{ text ? ' · ' : ''
        }}<button
          type="button"
          class="pointer-events-auto cursor-pointer rounded-sm text-foreground outline-none hover:underline focus-visible:underline focus-visible:ring-1 focus-visible:ring-ring"
          :aria-label="t('chooser.updateAvailableOpen', { name: buildName })"
          data-testid="build-update-open"
          @click.stop="openUpdate"
        >
          {{ shortLabel ? t('chooser.updateShort') : t('chooser.updateAvailable') }}
        </button></span
      >
    </template>
  </span>
</template>
