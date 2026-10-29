<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { installTypeMetaForInstall } from '../../lib/installTypeIcon'
import { TID } from '../../../../shared/testIds'
import type { Installation } from '../../types/ipc'

// Compact list-row for the picker's left pane. Body click emits `select`
// (updates the right detail pane only; doesn't launch).

interface Props {
  installation: Installation
  active?: boolean
  running?: boolean
  /** Install whose host window opened the picker; drives the "Current" pill. */
  isCurrent?: boolean
  /** Drives the orange dot, which takes precedence over the green running dot. */
  updateAvailable?: boolean
  /** Background op in flight; spinner dot takes precedence over the other dots. */
  operating?: boolean
  lastLaunchedShortLabel: string
}

const props = withDefaults(defineProps<Props>(), {
  active: false,
  running: false,
  isCurrent: false,
  updateAvailable: false,
  operating: false
})

const { t } = useI18n()

const emit = defineEmits<{
  select: [installation: Installation]
}>()

const typeMeta = computed(() => installTypeMetaForInstall(props.installation))

function handleClick(): void {
  emit('select', props.installation)
}
</script>

<template>
  <div class="picker-row-wrap box-border w-full px-2 py-0.5">
    <div
      role="option"
      :aria-selected="active"
      tabindex="0"
      class="picker-row group/instance grid grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-lg border border-solid border-transparent py-2 pr-2 pl-2.5 text-left text-inherit cursor-pointer transition-[background-color] duration-[120ms] ease-[ease] focus-visible:outline-none"
      :class="[
        active
          ? 'is-active bg-accent'
          : 'hover:bg-[var(--chooser-surface-border)] focus-visible:bg-[var(--chooser-surface-border)]',
        { 'is-running': running }
      ]"
      :data-testid="TID.pickerRow(installation.id)"
      @click="handleClick"
      @keydown.enter="handleClick"
      @keydown.space.prevent="handleClick"
    >
      <div
        class="picker-row-icon relative flex size-6 flex-none items-center justify-center text-neutral-100 transition-[color] duration-[120ms] ease-[ease] group-aria-selected/instance:text-text"
        :title="$t(typeMeta.labelKey)"
      >
        <component :is="typeMeta.icon" :size="20" />
        <span
          v-if="operating"
          class="picker-row-op-dot absolute -right-px -bottom-px box-content size-1.5 rounded-[50%] border-2 border-solid border-neutral-800 bg-[conic-gradient(var(--brand-accent,#f5c518)_270deg,transparent_270deg)] animate-spin [animation-duration:800ms]"
          aria-hidden="true"
        ></span>
        <span
          v-else-if="updateAvailable"
          class="picker-row-update-dot absolute -right-px -bottom-px box-content size-1.5 rounded-[50%] border-2 border-solid border-neutral-800 bg-[var(--status-update,#f59e0b)]"
          aria-hidden="true"
        ></span>
        <span
          v-else-if="running"
          class="picker-row-running-dot absolute -right-px -bottom-px box-content size-1.5 rounded-[50%] border-2 border-solid border-neutral-800 bg-[#38c149]"
          aria-hidden="true"
        ></span>
      </div>
      <div class="picker-row-body flex min-w-0 items-center gap-2 overflow-hidden">
        <span
          class="picker-row-name min-w-0 flex-auto truncate text-[14px] leading-5 font-medium text-neutral-100 group-aria-selected/instance:text-text"
          >{{ installation.name }}</span
        >
        <span
          v-if="isCurrent"
          class="picker-row-current-pill flex-none rounded-[999px] bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap text-text-muted group-aria-selected/instance:bg-[color-mix(in_srgb,var(--text)_14%,transparent)] group-aria-selected/instance:text-text"
        >
          {{ t('snapshots.current') }}
        </span>
        <span
          v-else-if="lastLaunchedShortLabel"
          class="picker-row-recency flex-none text-[12px] leading-4 whitespace-nowrap text-text-muted"
        >
          {{ lastLaunchedShortLabel }}
        </span>
      </div>
    </div>
  </div>
</template>
