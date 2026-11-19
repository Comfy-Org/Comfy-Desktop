<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { installTypeMetaForInstall } from '../../lib/installTypeIcon'
import { TID } from '../../../../shared/testIds'
import type { Installation } from '../../types/ipc'

interface Props {
  installation: Installation
  active?: boolean
  running?: boolean
  isCurrent?: boolean
  updateAvailable?: boolean
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
  <div class="picker-row-wrap box-border w-full px-2">
    <div
      role="option"
      :aria-selected="active"
      tabindex="0"
      class="picker-row group/instance box-border grid h-8 grid-cols-[16px_minmax(0,1fr)] items-center gap-2.5 rounded-lg px-3 text-left text-inherit cursor-pointer transition-[background-color] duration-[120ms] ease-[ease] focus-visible:outline-none"
      :class="[
        active
          ? 'is-active bg-[var(--picker-row-active,var(--color-accent))]'
          : 'hover:bg-[var(--picker-row-hover,var(--chooser-surface-border))] focus-visible:bg-[var(--picker-row-hover,var(--chooser-surface-border))]',
        { 'is-running': running }
      ]"
      :data-testid="TID.pickerRow(installation.id)"
      @click="handleClick"
      @keydown.enter="handleClick"
      @keydown.space.prevent="handleClick"
    >
      <div
        class="picker-row-icon relative flex size-4 flex-none items-center justify-center text-neutral-100 transition-[color] duration-[120ms] ease-[ease] group-aria-selected/instance:text-text"
        :title="$t(typeMeta.labelKey)"
      >
        <component :is="typeMeta.icon" :size="16" />
        <span
          v-if="operating"
          class="picker-row-op-dot absolute -right-0.5 -bottom-0.5 box-content size-1.5 rounded-[50%] border-2 border-solid border-[var(--picker-side-bg,var(--color-neutral-800))] group-hover/instance:border-[var(--picker-row-hover,var(--color-neutral-800))] group-aria-selected/instance:border-[var(--picker-row-active,var(--color-neutral-800))]! bg-[conic-gradient(var(--brand-accent,#f5c518)_270deg,transparent_270deg)] animate-spin [animation-duration:800ms]"
          aria-hidden="true"
        ></span>
        <span
          v-else-if="updateAvailable"
          class="picker-row-update-dot absolute -right-0.5 -bottom-0.5 box-content size-1.5 rounded-[50%] border-2 border-solid border-[var(--picker-side-bg,var(--color-neutral-800))] group-hover/instance:border-[var(--picker-row-hover,var(--color-neutral-800))] group-aria-selected/instance:border-[var(--picker-row-active,var(--color-neutral-800))]! bg-[var(--status-update,#f59e0b)]"
          aria-hidden="true"
        ></span>
        <span
          v-else-if="running"
          class="picker-row-running-dot absolute -right-0.5 -bottom-0.5 box-content size-1.5 rounded-[50%] border-2 border-solid border-[var(--picker-side-bg,var(--color-neutral-800))] group-hover/instance:border-[var(--picker-row-hover,var(--color-neutral-800))] group-aria-selected/instance:border-[var(--picker-row-active,var(--color-neutral-800))]! bg-[#38c149]"
          aria-hidden="true"
        ></span>
      </div>
      <div class="picker-row-body flex min-w-0 items-center gap-2 overflow-hidden">
        <span
          class="picker-row-name min-w-0 flex-auto truncate text-[13px] leading-5 font-medium text-neutral-100 group-aria-selected/instance:text-text"
          >{{ installation.name }}</span
        >
        <span
          v-if="isCurrent"
          class="picker-row-current-pill flex-none rounded-[999px] px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap text-text-muted shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text)_22%,transparent)] group-aria-selected/instance:text-text group-aria-selected/instance:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text)_30%,transparent)]"
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
