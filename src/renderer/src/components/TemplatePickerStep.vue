<script setup lang="ts">
import { computed, nextTick, reactive, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Crown, HardDriveDownload } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import type { DiskSpaceInfo, FieldOption } from '../types/ipc'
import { formatBytesCoarse } from '../lib/formatting'
import {
  templateDiskRequiredBytes,
  isTemplateDiskBlocked,
  isApiNodeTemplate,
  templateDownloadBytes,
  templateSizeBytes
} from '../lib/installHelpers'
import { useTemplateTabs } from '../composables/useTemplateTabs'
import ComfyCLogo from './icons/ComfyCLogo.vue'
import TruncatedText from './TruncatedText.vue'
import Tooltip from './ui/Tooltip.vue'

/**
 * Starter-template picker — modality tabs (Image / Video / 3D / Audio) over a
 * gallery of image cards, each with a name/task/size info bar below the preview.
 * The disk alert is surfaced to (and rendered by) the host wizard.
 */
const props = withDefaults(
  defineProps<{
    options: FieldOption[]
    /** Value of the "no template" option to hide from the cards, when the list has one. */
    noneValue?: string
    selectedValue: string | null
    diskSpace: DiskSpaceInfo | null
    diskSpaceLoading: boolean
    compact?: boolean
  }>(),
  { noneValue: '', compact: false }
)

const emit = defineEmits<{
  select: [option: FieldOption]
}>()

const { t } = useI18n()

const listRef = ref<HTMLElement | null>(null)

const { tabs, activeModality, visibleCards, selectTab } = useTemplateTabs(
  toRef(props, 'options'),
  toRef(props, 'noneValue'),
  toRef(props, 'selectedValue'),
  t
)

const selectedOption = computed(
  () => props.options.find((o) => o.value === props.selectedValue) ?? null
)

const thumbFailed = reactive<Record<string, boolean>>({})
/** Per-card load state, so a card fades its image in (and shows the branded
 *  placeholder meanwhile) instead of flashing a blank box. */
const thumbLoaded = reactive<Record<string, boolean>>({})

const sizeBytesOf = templateSizeBytes
/** Card preview URL, or null for non-image previews (audio → branded tile). */
function thumbnailOf(option: FieldOption): string | null {
  const url = option.data?.thumbnailUrl
  return typeof url === 'string' && url ? url : null
}
function sizeLabelOf(option: FieldOption): string {
  const bytes = sizeBytesOf(option)
  return bytes > 0 ? `~${formatBytesCoarse(bytes)}` : ''
}
function modelsPresentOf(option: FieldOption): boolean {
  return option.data?.modelsPresent === true
}
/** Tooltip/AT text: "Downloaded · ~17 GB", or just the word when size is unknown. */
function presentLabelOf(option: FieldOption): string {
  const downloaded = t('standalone.templateModelsDownloaded')
  const size = sizeLabelOf(option)
  return size ? `${downloaded} · ${size}` : downloaded
}
function hasNothingToDownload(option: FieldOption): boolean {
  return isApiNodeTemplate(option) && sizeBytesOf(option) === 0
}
/** Short model name (falls back to the full label). */
function nameOf(option: FieldOption): string {
  const name = option.data?.name
  return typeof name === 'string' && name ? name : option.label
}
/** Task descriptor subtitle (e.g. "Text to Image"), or '' when none. */
function taskOf(option: FieldOption): string {
  const task = option.data?.task
  return typeof task === 'string' ? task : ''
}
/** True while a real thumbnail is still in flight — drives the loader pulse.
 *  A template with no image preview (audio) shows a static branded tile. */
function isThumbLoading(option: FieldOption): boolean {
  return !!thumbnailOf(option) && !thumbLoaded[option.value] && !thumbFailed[option.value]
}

const diskBlocked = computed(
  () =>
    !props.diskSpaceLoading &&
    isTemplateDiskBlocked(props.diskSpace, templateDownloadBytes(selectedOption.value))
)

const shownDiskError = computed<string | null>(() => {
  if (!diskBlocked.value || !props.diskSpace) return null
  const required = templateDiskRequiredBytes(templateDownloadBytes(selectedOption.value))
  return t('diskSpace.templateBlockMessage', {
    required: formatBytesCoarse(required),
    free: formatBytesCoarse(props.diskSpace.free)
  })
})

function focusRow(index: number): void {
  nextTick(() => {
    listRef.value?.querySelectorAll<HTMLButtonElement>('button[role="radio"]')[index]?.focus()
  })
}

/** Arrow/Home/End navigation, scoped to the active tab's cards. The gallery is a
 *  single horizontal row, so Left/Right and Up/Down both step between cards. */
function onRowKeydown(e: KeyboardEvent, index: number): void {
  const last = visibleCards.value.length - 1
  let nextIndex: number
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nextIndex = Math.min(index + 1, last)
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nextIndex = Math.max(index - 1, 0)
  else if (e.key === 'Home') nextIndex = 0
  else if (e.key === 'End') nextIndex = last
  else return

  e.preventDefault()
  if (nextIndex === index) return
  const next = visibleCards.value[nextIndex]
  if (!next) return
  emit('select', next)
  focusRow(nextIndex)
}

// Disk alert message; the host wizard renders it above the card (so it's
// never clipped by the list scroll) and owns the blocked-Install shake.
defineExpose({ shownDiskError })
</script>

<template>
  <div :class="['tps w-full text-center', { 'tps--compact': compact }]">
    <div
      v-if="tabs.length > 1"
      class="tps__tabs mb-[clamp(16px,3vh,28px)] flex flex-wrap justify-center gap-2"
      role="tablist"
      :aria-label="t('standalone.templateTabsAria')"
    >
      <Button
        v-for="tab in tabs"
        :key="tab.modality"
        size="unset"
        variant="textonly"
        type="button"
        role="tab"
        :aria-selected="activeModality === tab.modality"
        :class="[
          'tps__tab static inline-flex appearance-auto items-center justify-normal gap-1.5 rounded-md border border-solid px-3.5 py-2 font-sans text-[13px] leading-[inherit] font-normal whitespace-normal touch-auto transition-[border-color,background,color] duration-160 ease-[ease] [&]:[appearance:button] hover:border-[var(--brand-surface-border-hover)] hover:bg-[var(--brand-surface-bg-hover)] focus-visible:ring-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2',
          activeModality === tab.modality
            ? 'tps__tab--selected border-[color-mix(in_oklab,var(--neutral-100)_45%,transparent)] bg-[color-mix(in_oklab,var(--neutral-100)_12%,transparent)] text-neutral-100 hover:border-[color-mix(in_oklab,var(--neutral-100)_45%,transparent)] hover:bg-[color-mix(in_oklab,var(--neutral-100)_12%,transparent)]'
            : 'border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] text-neutral-200'
        ]"
        @click="selectTab(tab.modality)"
      >
        <component :is="tab.glyph" :size="16" aria-hidden="true" />
        {{ tab.label }}
      </Button>
    </div>

    <div
      ref="listRef"
      class="tps__grid grid w-full gap-[clamp(12px,1.4vw,20px)]"
      :class="
        compact
          ? 'grid-cols-[repeat(auto-fill,minmax(180px,220px))] justify-center'
          : 'grid-cols-[repeat(auto-fit,minmax(180px,1fr))]'
      "
      role="radiogroup"
      :aria-label="t('standalone.templatePickerTitle')"
    >
      <Button
        v-for="(opt, index) in visibleCards"
        :key="opt.value"
        size="unset"
        variant="textonly"
        type="button"
        role="radio"
        :aria-checked="selectedValue === opt.value"
        :title="opt.description || undefined"
        :class="[
          'tps__card group/template relative isolate flex appearance-auto flex-col items-stretch justify-normal gap-0 overflow-hidden rounded-xl border border-solid bg-[var(--chooser-surface-bg)] p-0 font-sans text-sm leading-[inherit] font-normal whitespace-normal text-text touch-auto transition-[border-color,box-shadow] duration-140 ease-[ease] [&]:[appearance:button] hover:bg-[var(--chooser-surface-bg)] hover:border-[var(--brand-surface-border-hover)] focus-visible:ring-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2',
          selectedValue === opt.value
            ? 'tps__card--selected border-neutral-100 [box-shadow:0_0_0_1px_var(--neutral-100),0_8px_24px_color-mix(in_oklab,var(--neutral-950)_45%,transparent)] [&[aria-checked=true]:focus-visible]:[box-shadow:0_0_0_1px_var(--neutral-100),0_8px_24px_color-mix(in_oklab,var(--neutral-950)_45%,transparent)]'
            : 'border-[var(--brand-surface-border)]'
        ]"
        @click="emit('select', opt)"
        @keydown="onRowKeydown($event, index)"
      >
        <span class="tps__card-media relative aspect-4/3 text-neutral-500" aria-hidden="true">
          <span
            class="tps__card-fallback absolute inset-0 flex items-center justify-center text-neutral-300 [background:radial-gradient(120%_120%_at_50%_0%,color-mix(in_oklab,var(--neutral-700)_55%,transparent)_0%,transparent_70%),var(--chooser-surface-bg)]"
            :class="{
              'tps__card-fallback--loading animate-[template-preview-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none':
                isThumbLoading(opt)
            }"
          >
            <ComfyCLogo :size="44" />
          </span>
          <img
            v-if="thumbnailOf(opt) && !thumbFailed[opt.value]"
            :src="thumbnailOf(opt)!"
            :alt="opt.label"
            draggable="false"
            :class="[
              'tps__card-img absolute inset-0 size-full object-cover [transition:opacity_200ms_ease,transform_260ms_ease] motion-reduce:transition-none',
              thumbLoaded[opt.value]
                ? 'tps__card-img--ready opacity-100 group-hover/template:[transform:scale(1.05)] motion-reduce:group-hover/template:[transform:none]'
                : 'opacity-0'
            ]"
            @load="thumbLoaded[opt.value] = true"
            @error="thumbFailed[opt.value] = true"
          />

          <span
            v-if="selectedValue === opt.value"
            class="tps__check absolute top-2.5 right-2.5 z-1 inline-flex size-[22px] items-center justify-center rounded-[999px] bg-neutral-50 text-neutral-950 [box-shadow:0_2px_8px_color-mix(in_oklab,var(--neutral-950)_55%,transparent)]"
            aria-hidden="true"
          >
            <Check :size="13" :stroke-width="3" />
          </span>
          <span
            v-if="opt.recommended"
            class="tps__recommended absolute top-2 left-2 z-1 rounded-md bg-[color-mix(in_oklab,var(--neutral-950)_30%,transparent)] px-2 py-1 text-xs leading-[normal] font-normal tracking-normal text-neutral-100 backdrop-blur-[20px]"
          >
            {{ t('newInstall.recommended') }}
          </span>
        </span>

        <!-- Outside the aria-hidden media span so the cost reaches the accessible name. -->
        <span
          v-if="isApiNodeTemplate(opt)"
          class="tps__api absolute top-2 left-2 z-1 inline-flex items-center gap-1 rounded-[999px] bg-neutral-900 px-[9px] py-1 text-[9px] font-bold tracking-[0.06em] whitespace-nowrap text-[var(--upgrade)] uppercase [box-shadow:0_2px_10px_color-mix(in_oklab,var(--neutral-950)_55%,transparent)]"
        >
          <Crown :size="12" :stroke-width="2.5" aria-hidden="true" />
          {{ t('standalone.templateApiBadge') }}
        </span>

        <span
          class="tps__card-footer flex items-baseline justify-between gap-2.5 border-t border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] px-3 py-2.5 text-left"
        >
          <span class="tps__card-text flex min-w-0 flex-auto flex-col gap-px">
            <TruncatedText
              class="tps__card-title min-w-0 text-[length:var(--takeover-fs-body)] leading-[1.3] font-semibold text-neutral-100"
              :text="nameOf(opt)"
            />
            <span
              v-if="taskOf(opt)"
              class="tps__card-task truncate text-[length:var(--takeover-fs-caption)] text-neutral-400"
              >{{ taskOf(opt) }}</span
            >
            <span v-if="modelsPresentOf(opt)" class="sr-only">{{ presentLabelOf(opt) }}</span>
          </span>
          <Tooltip
            v-if="modelsPresentOf(opt)"
            :text="presentLabelOf(opt)"
            class="tps__card-present inline-flex flex-none items-center text-neutral-300"
          >
            <HardDriveDownload :size="14" :stroke-width="2" aria-hidden="true" />
          </Tooltip>
          <!-- Decorative: the badge above already names the cost. -->
          <Crown
            v-else-if="hasNothingToDownload(opt)"
            class="tps__card-crown flex-none text-[var(--upgrade)]"
            :size="14"
            :stroke-width="2.5"
            :aria-hidden="true"
          />
          <span
            v-else-if="sizeLabelOf(opt)"
            class="tps__card-size flex-none text-[11px] font-semibold tracking-[0.01em] text-neutral-300"
            >{{ sizeLabelOf(opt) }}</span
          >
        </span>
      </Button>
    </div>
  </div>
</template>

<style>
/* The thumbnail placeholder keeps the original 45%–85% pulse. */
@keyframes template-preview-pulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 0.85;
  }
}
</style>
