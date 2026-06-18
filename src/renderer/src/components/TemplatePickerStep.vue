<script setup lang="ts">
import { computed, nextTick, reactive, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'
import type { DiskSpaceInfo, FieldOption } from '../types/ipc'
import { formatBytesCoarse } from '../lib/formatting'
import { templateDiskRequiredBytes, isTemplateDiskBlocked } from '../lib/installHelpers'
import { useTemplateTabs } from '../composables/useTemplateTabs'
import ComfyCLogo from './icons/ComfyCLogo.vue'

/**
 * Starter-template picker — modality tabs (Image / Video / 3D / Audio) over a
 * gallery of image-forward cards: the thumbnail fills the card, the title +
 * size sit on a bottom scrim, the description is the card's hover title. The
 * disk alert is surfaced to (and rendered by) the host wizard; footer actions
 * live there too.
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

function sizeBytesOf(option: FieldOption | null): number {
  const size = option?.data?.sizeBytes
  return typeof size === 'number' ? size : 0
}
function thumbnailOf(option: FieldOption): string | null {
  const url = option.data?.thumbnailUrl
  return typeof url === 'string' && url ? url : null
}
function isAnimated(option: FieldOption): boolean {
  return option.data?.previewKind === 'animated'
}

const reduceMotion = ref(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false)

/** Preview URL for a row: the paired `<id>-still.webp` frame when the template
 *  is animated AND the user prefers reduced motion, otherwise the bundled
 *  `<id>.webp` (which itself animates for motion templates). */
function previewSrcOf(option: FieldOption): string | null {
  const url = thumbnailOf(option)
  if (!url) return null
  if (isAnimated(option) && reduceMotion.value) {
    return url.replace(/\.webp$/, '-still.webp')
  }
  return url
}
function sizeLabelOf(option: FieldOption): string {
  const bytes = sizeBytesOf(option)
  return bytes > 0 ? `~${formatBytesCoarse(bytes)}` : ''
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
          <img
            v-if="previewSrcOf(opt) && !thumbFailed[opt.value]"
            :src="previewSrcOf(opt)!"
            :alt="opt.label"
            draggable="false"
            @error="thumbFailed[opt.value] = true"
          />
          <span v-else class="tps__card-fallback">
            <ComfyCLogo :size="44" />
          </span>
        </span>

        <span v-if="opt.recommended" class="tps__badge tps__recommended">
          {{ t('newInstall.recommended') }}
        </span>
        <span
          v-if="selectedValue === opt.value"
          class="tps__badge tps__card-check"
          aria-hidden="true"
        >
          <Check :size="14" :stroke-width="2.5" />
        </span>

        <span class="tps__card-footer">
          <span class="tps__card-title">{{ opt.label }}</span>
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
  position: relative;
  display: block;
  aspect-ratio: 1 / 1;
  border: 1px solid var(--brand-surface-border);
  border-radius: 12px;
  background: var(--chooser-surface-bg);
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  isolation: isolate;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.tps__card:hover {
  border-color: var(--brand-surface-border-hover);
}
.tps__card:hover .tps__card-media img {
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
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--neutral-500);
}
.tps__card-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 140ms ease;
}

.tps__card-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--neutral-300);
  background:
    radial-gradient(
      120% 120% at 50% 0%,
      color-mix(in oklab, var(--neutral-700) 55%, transparent) 0%,
      transparent 70%
    ),
    var(--chooser-surface-bg);
}

.tps__card::after {
  content: '';
  position: absolute;
  inset: 35% 0 0;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    color-mix(in oklab, var(--neutral-950) 55%, transparent) 55%,
    color-mix(in oklab, var(--neutral-950) 92%, transparent) 100%
  );
  pointer-events: none;
}

.tps__card-footer {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 12px 14px;
  text-align: left;
}
.tps__card-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: var(--takeover-fs-body);
  font-weight: 600;
  line-height: 1.25;
  color: var(--neutral-100);
  text-shadow: 0 1px 8px color-mix(in oklab, var(--neutral-950) 75%, transparent);
}
.tps__card-size {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--neutral-100);
  text-shadow: 0 1px 8px color-mix(in oklab, var(--neutral-950) 75%, transparent);
}

.tps__badge {
  position: absolute;
  top: 10px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tps__recommended {
  right: 10px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--neutral-100);
  background: color-mix(in oklab, var(--neutral-950) 60%, transparent);
  border: 1px solid color-mix(in oklab, var(--neutral-100) 28%, transparent);
  backdrop-filter: blur(8px);
}

.tps__card-check {
  left: 10px;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: var(--neutral-950);
  background: var(--neutral-100);
  box-shadow: 0 1px 6px color-mix(in oklab, var(--neutral-950) 50%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .tps__card-media img {
    transition: none;
  }
}
</style>
