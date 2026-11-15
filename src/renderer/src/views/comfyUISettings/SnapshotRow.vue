<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { ChevronRight } from 'lucide-vue-next'
import type { SnapshotSummary } from '../../types/ipc'
import {
  triggerLabel as _triggerLabel,
  formatRelative as _formatRelative,
  formatDate,
  isDisplayableLabel
} from '../../lib/snapshots'
import BaseAccordion from '../../components/ui/BaseAccordion.vue'

interface Props {
  snapshot: SnapshotSummary
  expanded: boolean
  isLatest?: boolean
  previousComfyuiVersion?: string
  toggleTestId?: string
}

const props = withDefaults(defineProps<Props>(), {
  isLatest: false,
  previousComfyuiVersion: undefined,
  toggleTestId: undefined
})

const emit = defineEmits<{
  toggle: []
}>()

const { t } = useI18n()

const triggerCopy = computed(() => _triggerLabel(props.snapshot.trigger, t))
const relativeCopy = computed(() => _formatRelative(props.snapshot.createdAt, t))
const absoluteCopy = computed(() => formatDate(props.snapshot.createdAt))

const triggerTone = computed<'state' | 'neutral'>(() => {
  switch (props.snapshot.trigger) {
    case 'post-update':
    case 'post-restore':
      return 'state'
    default:
      return 'neutral'
  }
})

const nodeDelta = computed(() => {
  const d = props.snapshot.diffVsPrevious
  return {
    added: d?.nodesAdded ?? 0,
    removed: d?.nodesRemoved ?? 0,
    changed: d?.nodesChanged ?? 0
  }
})
const hasNodeChanges = computed(
  () => nodeDelta.value.added + nodeDelta.value.removed + nodeDelta.value.changed > 0
)

const pipDelta = computed(() => {
  const diff = props.snapshot.diffVsPrevious
  return {
    added: diff?.pipsAdded ?? 0,
    removed: diff?.pipsRemoved ?? 0,
    changed: diff?.pipsChanged ?? 0
  }
})
const hasPipChanges = computed(
  () => pipDelta.value.added + pipDelta.value.removed + pipDelta.value.changed > 0
)

const hasCustomLabel = computed(() => isDisplayableLabel(props.snapshot.label))
const comfyuiChanged = computed(
  () => !!props.snapshot.diffVsPrevious?.comfyuiChanged && !!props.previousComfyuiVersion
)
const titlePillText = computed(() => {
  if (hasCustomLabel.value) return props.snapshot.label as string
  if (comfyuiChanged.value)
    return `${props.previousComfyuiVersion} → ${props.snapshot.comfyuiVersion}`
  return props.snapshot.comfyuiVersion
})
const hasTitlePill = computed(() => !!titlePillText.value)
const showVersionChange = computed(() => !hasCustomLabel.value && comfyuiChanged.value)
</script>

<template>
  <div class="snapshot-row flex flex-col" :class="{ 'is-expanded': expanded }">
    <div
      class="snapshot-row-line flex min-h-11 items-center gap-2 rounded-[10px] pr-1.5 pl-2.5 transition-[background-color] duration-100 ease-[ease] hover:bg-[color-mix(in_oklch,var(--color-foreground)_4%,transparent)] has-[:focus-visible]:bg-[color-mix(in_oklch,var(--color-foreground)_4%,transparent)] has-[.snapshot-row-head:focus-visible]:outline-2 has-[.snapshot-row-head:focus-visible]:-outline-offset-2 has-[.snapshot-row-head:focus-visible]:outline-[var(--accent-primary)]"
    >
      <Button
        type="button"
        variant="textonly"
        size="unset"
        class="snapshot-row-head @container static flex h-11 min-w-0 flex-1 items-center overflow-hidden justify-normal gap-2.5 rounded-none border-none bg-transparent p-0 text-left text-inherit whitespace-nowrap [font:inherit] appearance-auto hover:bg-transparent focus-visible:outline-none focus-visible:ring-0"
        :aria-expanded="expanded"
        :data-testid="toggleTestId"
        @click="emit('toggle')"
      >
        <span
          class="snapshot-row-time w-[76px] shrink-0 truncate text-[12px] text-text-muted"
          :title="absoluteCopy"
          >{{ relativeCopy }}</span
        >
        <span class="w-5 shrink-0" aria-hidden="true"></span>
        <ChevronRight
          :size="14"
          class="snapshot-row-chevron shrink-0 text-[var(--color-subtle-foreground)] transition-transform duration-150 ease-[ease]"
          :class="{ 'rotate-90': expanded }"
          aria-hidden="true"
        />
        <span
          class="snapshot-row-trigger shrink-0 rounded-md bg-[color-mix(in_oklch,var(--color-foreground)_8%,transparent)] px-[7px] py-px text-[12px] text-text-muted data-[tone=state]:bg-[color-mix(in_oklch,var(--color-foreground)_13%,transparent)] data-[tone=state]:text-neutral-100"
          :data-tone="triggerTone"
          >{{ triggerCopy }}</span
        >
        <span
          v-if="hasTitlePill"
          class="snap-pill snap-pill--version snapshot-row-name min-w-0 truncate text-[13px] font-medium text-neutral-100 tabular-nums"
          :class="{ 'is-change': showVersionChange }"
          :title="titlePillText"
        >
          <template v-if="showVersionChange"
            ><span class="mr-1 text-text-muted">{{ previousComfyuiVersion }} →</span>
            <span class="font-semibold text-[var(--color-foreground)]">{{
              snapshot.comfyuiVersion
            }}</span></template
          >
          <template v-else>{{ titlePillText }}</template>
        </span>
        <span
          v-if="isLatest"
          class="snapshot-row-latest inline-flex h-5 shrink-0 items-center rounded-full bg-[color-mix(in_oklch,var(--color-foreground)_7%,transparent)] px-2 text-[11px] leading-none font-medium text-text-muted"
        >
          {{ t('snapshots.latestBadge') }}
        </span>
        <span
          v-if="hasNodeChanges || hasPipChanges"
          class="snapshot-row-delta hidden shrink-0 items-center @md:inline-flex gap-1.5 text-[12px] text-text-muted tabular-nums"
        >
          <span v-if="hasNodeChanges" class="snap-pill snap-pill--nodes inline-flex gap-1">
            <span v-if="nodeDelta.added" class="snap-delta is-add text-[var(--success)]"
              >+{{ nodeDelta.added }}</span
            >
            <span v-if="nodeDelta.removed" class="snap-delta is-remove text-danger"
              >−{{ nodeDelta.removed }}</span
            >
            <span v-if="nodeDelta.changed" class="snap-delta is-change text-neutral-100"
              >~{{ nodeDelta.changed }}</span
            >
            <span class="snap-pill-label">{{ t('snapshots.nodesLabel') }}</span>
          </span>
          <span v-if="hasNodeChanges && hasPipChanges" aria-hidden="true">·</span>
          <span v-if="hasPipChanges" class="snap-pill snap-pill--pkgs inline-flex gap-1">
            <span v-if="pipDelta.added" class="snap-delta is-add text-[var(--success)]"
              >+{{ pipDelta.added }}</span
            >
            <span v-if="pipDelta.removed" class="snap-delta is-remove text-danger"
              >−{{ pipDelta.removed }}</span
            >
            <span v-if="pipDelta.changed" class="snap-delta is-change text-neutral-100"
              >~{{ pipDelta.changed }}</span
            >
            <span class="snap-pill-label">{{ t('snapshots.pkgsLabel') }}</span>
          </span>
        </span>
      </Button>
      <div class="snapshot-row-actions ml-auto flex shrink-0 items-center gap-1">
        <slot name="actions" />
      </div>
    </div>

    <BaseAccordion :open="expanded">
      <div class="snapshot-row-card flex flex-col gap-2.5 pt-1 pr-4 pb-4 pl-[126px]">
        <div
          class="snapshot-row-meta flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--color-subtle-foreground)] [overflow-wrap:anywhere]"
        >
          <span>{{ t('snapshots.nodesCount', { count: snapshot.nodeCount }) }}</span>
          <span class="snapshot-row-meta-dot" aria-hidden="true">·</span>
          <span>{{ t('snapshots.packagesCount', { count: snapshot.pipPackageCount }) }}</span>
          <slot name="meta" />
        </div>
        <div class="snapshot-row-expanded flex flex-col gap-2.5">
          <slot name="expanded" />
        </div>
      </div>
    </BaseAccordion>
  </div>
</template>
