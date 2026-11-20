<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'
import { ArrowUpCircle } from '@lucide/vue'
import Tooltip from '../../components/ui/Tooltip.vue'

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
const iconOnly = ref(false)

function fitNote(): void {
  const line = lineEl.value
  const fullNote = fullNoteEl.value
  if (!line || !fullNote) {
    iconOnly.value = false
    return
  }
  const textWidth = textEl.value?.scrollWidth ?? 0
  iconOnly.value = textWidth + fullNote.getBoundingClientRect().width > line.clientWidth + 0.5
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
        class="pointer-events-none invisible absolute top-0 right-0 flex items-center whitespace-pre before:content-[attr(data-separator)]"
        :data-separator="text ? ' · ' : ''"
        aria-hidden="true"
        data-testid="build-update-note-sizer"
        ><span
          class="flex items-center gap-1 after:content-[attr(data-label)]"
          :data-label="t('chooser.updateAvailable')"
          ><span class="size-3 shrink-0" /></span
      ></span>
      <span
        class="flex shrink-0 items-center whitespace-pre"
        :data-icon-only="iconOnly ? 'true' : undefined"
        data-testid="build-update-note"
        >{{ text ? ' · ' : ''
        }}<Tooltip
          class="pointer-events-auto shrink-0"
          :text="t('chooser.updateAvailable')"
          :disabled="!iconOnly"
          side="top"
          ><button
            type="button"
            class="group/update pointer-events-auto flex cursor-pointer items-center gap-1 rounded-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            :aria-label="t('chooser.updateAvailableOpen', { name: buildName })"
            data-testid="build-update-open"
            @click.stop="openUpdate"
          >
            <ArrowUpCircle :size="12" class="shrink-0" aria-hidden="true" /><span
              v-if="!iconOnly"
              class="group-hover/update:underline group-focus-visible/update:underline"
              >{{ t('chooser.updateAvailable') }}</span
            >
          </button></Tooltip
        ></span
      >
    </template>
  </span>
</template>
