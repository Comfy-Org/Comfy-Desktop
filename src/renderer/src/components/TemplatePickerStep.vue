<script setup lang="ts">
import { computed, nextTick, reactive, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'
import type { DiskSpaceInfo, FieldOption } from '../types/ipc'
import { formatBytesCoarse } from '../lib/formatting'
import { templateDiskRequiredBytes, isTemplateDiskBlocked } from '../lib/installHelpers'
import { useTemplateTabs } from '../composables/useTemplateTabs'
import ComfyCLogo from './icons/ComfyCLogo.vue'
import TruncatedText from './TruncatedText.vue'

/**
 * Starter-template picker — modality tabs (Image / Video / 3D / Audio) over a
 * gallery of image cards, each with a name/task/size info bar below the preview.
 * The disk alert is surfaced to (and rendered by) the host wizard.
 */
const props = defineProps<{
  options: FieldOption[]
  noneValue: string
  selectedValue: string | null
  diskSpace: DiskSpaceInfo | null
  diskSpaceLoading: boolean
}>()

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

function sizeBytesOf(option: FieldOption | null): number {
  const size = option?.data?.sizeBytes
  return typeof size === 'number' ? size : 0
}
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
    isTemplateDiskBlocked(props.diskSpace, sizeBytesOf(selectedOption.value))
)

const shownDiskError = computed<string | null>(() => {
  if (!diskBlocked.value || !props.diskSpace) return null
  const required = templateDiskRequiredBytes(sizeBytesOf(selectedOption.value))
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
  <div class="tps">
    <div
      v-if="tabs.length > 1"
      class="tps__tabs"
      role="tablist"
      :aria-label="t('standalone.templateTabsAria')"
    >
      <button
        v-for="tab in tabs"
        :key="tab.modality"
        type="button"
        role="tab"
        :aria-selected="activeModality === tab.modality"
        :class="['brand-pill', { 'brand-pill--selected': activeModality === tab.modality }]"
        @click="selectTab(tab.modality)"
      >
        <component :is="tab.glyph" :size="16" aria-hidden="true" />
        {{ tab.label }}
      </button>
    </div>

    <div
      ref="listRef"
      class="tps__grid"
      role="radiogroup"
      :aria-label="t('standalone.templatePickerTitle')"
    >
      <button
        v-for="(opt, index) in visibleCards"
        :key="opt.value"
        type="button"
        role="radio"
        :aria-checked="selectedValue === opt.value"
        :title="opt.description || undefined"
        :class="['tps__card', { 'tps__card--selected': selectedValue === opt.value }]"
        @click="emit('select', opt)"
        @keydown="onRowKeydown($event, index)"
      >
        <span class="tps__card-media" aria-hidden="true">
          <span
            class="tps__card-fallback"
            :class="{ 'tps__card-fallback--loading': isThumbLoading(opt) }"
          >
            <ComfyCLogo :size="44" />
          </span>
          <img
            v-if="thumbnailOf(opt) && !thumbFailed[opt.value]"
            :src="thumbnailOf(opt)!"
            :alt="opt.label"
            draggable="false"
            :class="['tps__card-img', { 'tps__card-img--ready': thumbLoaded[opt.value] }]"
            @load="thumbLoaded[opt.value] = true"
            @error="thumbFailed[opt.value] = true"
          />

          <span v-if="modelsPresentOf(opt)" class="tps__downloaded">
            <Check :size="12" :stroke-width="3" />
            {{ t('standalone.templateModelsDownloaded') }}
          </span>

          <span v-if="selectedValue === opt.value" class="tps__check" aria-hidden="true">
            <Check :size="13" :stroke-width="3" />
          </span>
          <span v-else-if="opt.recommended" class="tps__recommended">
            {{ t('newInstall.recommended') }}
          </span>
        </span>

        <span class="tps__card-footer">
          <span class="tps__card-text">
            <TruncatedText class="tps__card-title" :text="nameOf(opt)" />
            <span v-if="taskOf(opt)" class="tps__card-task">{{ taskOf(opt) }}</span>
            <span v-if="modelsPresentOf(opt)" class="sr-only">
              {{ t('standalone.templateModelsDownloaded') }}
            </span>
          </span>
          <span v-if="sizeLabelOf(opt)" class="tps__card-size">{{ sizeLabelOf(opt) }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tps {
  width: 100%;
  text-align: center;
}

.tps__tabs {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-bottom: clamp(16px, 3vh, 28px);
}
.tps__tabs .brand-pill--selected {
  border-color: color-mix(in oklab, var(--neutral-100) 45%, transparent);
  background: color-mix(in oklab, var(--neutral-100) 12%, transparent);
  color: var(--neutral-100);
}

.tps__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: clamp(12px, 1.4vw, 20px);
  width: 100%;
}

.tps__card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--brand-surface-border);
  border-radius: 12px;
  background: var(--chooser-surface-bg);
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  isolation: isolate;
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease;
}
.tps__card:hover {
  border-color: var(--brand-surface-border-hover);
}
.tps__card:hover .tps__card-img--ready {
  opacity: 0.88;
}
.tps__card:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.tps__card--selected {
  border-color: var(--neutral-100);
  box-shadow:
    0 0 0 1px var(--neutral-100),
    0 8px 24px color-mix(in oklab, var(--neutral-950) 45%, transparent);
}

.tps__card-media {
  position: relative;
  aspect-ratio: 4 / 3;
  color: var(--neutral-500);
}
.tps__card-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 200ms ease;
}
.tps__card-img--ready {
  opacity: 1;
}

.tps__card-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--neutral-300);
  background:
    radial-gradient(
      120% 120% at 50% 0%,
      color-mix(in oklab, var(--neutral-700) 55%, transparent) 0%,
      transparent 70%
    ),
    var(--chooser-surface-bg);
}
.tps__card-fallback--loading {
  animation: tps-pulse 1.6s ease-in-out infinite;
}

@keyframes tps-pulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 0.85;
  }
}

.tps__card-footer {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-top: 1px solid var(--brand-surface-border);
  background: var(--brand-surface-bg);
  text-align: left;
}
.tps__card-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1 1 auto;
}
.tps__card-title {
  min-width: 0;
  font-size: var(--takeover-fs-body);
  font-weight: 600;
  line-height: 1.3;
  color: var(--neutral-100);
}
.tps__card-task {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--takeover-fs-caption);
  color: var(--neutral-400);
}
.tps__card-size {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--neutral-300);
}

.tps__downloaded {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px 4px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--neutral-50);
  background: color-mix(in oklab, var(--neutral-950) 88%, transparent);
  box-shadow: 0 2px 10px color-mix(in oklab, var(--neutral-950) 55%, transparent);
}

.tps__check {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: var(--neutral-950);
  background: var(--neutral-50);
  box-shadow: 0 2px 8px color-mix(in oklab, var(--neutral-950) 55%, transparent);
}

.tps__recommended {
  position: absolute;
  bottom: 10px;
  right: 10px;
  z-index: 1;
  padding: 4px 9px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--neutral-100);
  background: var(--neutral-900);
  box-shadow: 0 2px 10px color-mix(in oklab, var(--neutral-950) 55%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .tps__card-img {
    transition: none;
  }
  .tps__card-fallback--loading {
    animation: none;
  }
}
</style>
