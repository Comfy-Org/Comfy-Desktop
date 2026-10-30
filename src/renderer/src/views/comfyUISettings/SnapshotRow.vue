<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { ChevronDown, Tag, Boxes, Package } from 'lucide-vue-next'
import type { SnapshotSummary } from '../../types/ipc'
import {
  triggerLabel as _triggerLabel,
  formatRelative as _formatRelative,
  formatDate,
  isDisplayableLabel
} from '../../lib/snapshots'
import BaseAccordion from '../../components/ui/BaseAccordion.vue'

/**
 * Snapshot timeline row: header (trigger label, badge, timestamp, chevron) plus an always-visible change-summary. Destructive actions live in the parent's detail panel.
 */

interface Props {
  snapshot: SnapshotSummary
  expanded: boolean
  /** First (newest) snapshot carries a "Latest" badge. */
  isLatest?: boolean
  /** Previous snapshot's ComfyUI version; when this snapshot changed it, the title pill shows `prev → this`. */
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

// `state` (post-update / post-restore) is highlighted as a real transition; everything else stays neutral.
const triggerTone = computed<'state' | 'neutral'>(() => {
  switch (props.snapshot.trigger) {
    case 'post-update':
    case 'post-restore':
      return 'state'
    default:
      return 'neutral'
  }
})

// Node-change deltas vs the previous snapshot, driving the collapsed-header pills.
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

// Pip-package deltas vs the previous snapshot, driving a second collapsed-header pill.
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

// Title pill: the snapshot's label, else a version transition `prev → this`, else
// the resulting version. Any displayable label shows, not just a manual one — a
// post-restore snapshot written after a failed or cancelled restore is labelled
// so the row cannot read as a completed restore (#1514). Older builds also
// wrote internal sentinels into `label`, which `isDisplayableLabel` filters out.
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
</script>

<template>
  <div class="snapshot-row flex flex-col gap-2" :class="{ 'is-expanded': expanded }">
    <!-- Whole header is the expand toggle. -->
    <Button
      type="button"
      variant="textonly"
      size="unset"
      class="snapshot-row-head static flex w-full flex-col items-stretch justify-normal gap-1.5 rounded-lg border-none bg-transparent p-0 text-left text-inherit whitespace-normal [font:inherit] appearance-auto hover:bg-transparent focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:[outline-style:solid] focus-visible:outline-[var(--accent-primary)] focus-visible:ring-0"
      :aria-expanded="expanded"
      :data-testid="toggleTestId"
      @click="emit('toggle')"
    >
      <div class="snapshot-row-head-top flex items-center justify-between gap-2.5">
        <div class="snapshot-row-head-left flex min-w-0 items-center gap-2">
          <span
            class="snapshot-row-trigger text-[12px] text-neutral-100 data-[tone=state]:text-[var(--warning)]"
            :data-tone="triggerTone"
            >{{ triggerCopy }}</span
          >
          <span
            v-if="isLatest"
            class="snapshot-row-latest shrink-0 rounded-[999px] bg-[color-mix(in_srgb,var(--text)_8%,transparent)] px-1.5 py-px text-[11px] leading-[16.5px] font-medium text-text-muted"
          >
            {{ t('snapshots.latestBadge', 'Latest') }}
          </span>
        </div>
        <div class="snapshot-row-head-right flex min-w-0 items-center gap-2">
          <span
            class="snapshot-row-time shrink-0 text-[12px] whitespace-nowrap text-text-muted"
            :title="absoluteCopy"
            >{{ relativeCopy }}</span
          >
          <ChevronDown
            :size="14"
            class="snapshot-row-chevron text-text-muted transition-transform duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
            :class="{ '[transform:rotate(180deg)]': expanded }"
          />
        </div>
      </div>
      <!-- At-a-glance pills: version/name pill + node deltas vs previous. -->
      <div
        v-if="hasTitlePill || hasNodeChanges || hasPipChanges"
        class="snapshot-row-pills flex flex-wrap items-center gap-1.5"
      >
        <span
          v-if="hasTitlePill"
          class="snap-pill snap-pill--version inline-flex min-w-0 max-w-full items-center gap-1 rounded-[999px] border border-solid bg-[var(--brand-surface-bg)] px-[7px] py-px text-[11px] leading-4 whitespace-nowrap text-neutral-100 tabular-nums [&>svg]:shrink-0 [&>svg]:opacity-70 [&>span]:min-w-0 [&>span]:truncate"
          :class="
            comfyuiChanged
              ? 'is-change border-[color-mix(in_srgb,var(--comfy-yellow,#f0ff41)_45%,var(--chooser-surface-border))]'
              : 'border-[var(--chooser-surface-border)]'
          "
          :title="titlePillText"
        >
          <Tag :size="11" aria-hidden="true" />
          <span>{{ titlePillText }}</span>
        </span>
        <span
          v-if="hasNodeChanges"
          class="snap-pill snap-pill--nodes inline-flex items-center gap-1 rounded-[999px] bg-snapshot-chip px-[7px] py-px text-[11px] leading-4 whitespace-nowrap text-text-muted [&>svg]:shrink-0 [&>svg]:opacity-70"
        >
          <Boxes :size="11" aria-hidden="true" />
          <span
            v-if="nodeDelta.added"
            class="snap-delta is-add font-semibold text-[#22c55e] tabular-nums"
            >+{{ nodeDelta.added }}</span
          >
          <span
            v-if="nodeDelta.removed"
            class="snap-delta is-remove font-semibold text-danger tabular-nums"
            >−{{ nodeDelta.removed }}</span
          >
          <span
            v-if="nodeDelta.changed"
            class="snap-delta is-change font-semibold text-[var(--warning)] tabular-nums"
            >~{{ nodeDelta.changed }}</span
          >
          <span class="snap-pill-label opacity-70">{{ t('snapshots.nodesLabel', 'nodes') }}</span>
        </span>
        <span
          v-if="hasPipChanges"
          class="snap-pill snap-pill--pkgs inline-flex items-center gap-1 rounded-[999px] bg-snapshot-chip px-[7px] py-px text-[11px] leading-4 whitespace-nowrap text-text-muted [&>svg]:shrink-0 [&>svg]:opacity-70"
        >
          <Package :size="11" aria-hidden="true" />
          <span
            v-if="pipDelta.added"
            class="snap-delta is-add font-semibold text-[#22c55e] tabular-nums"
            >+{{ pipDelta.added }}</span
          >
          <span
            v-if="pipDelta.removed"
            class="snap-delta is-remove font-semibold text-danger tabular-nums"
            >−{{ pipDelta.removed }}</span
          >
          <span
            v-if="pipDelta.changed"
            class="snap-delta is-change font-semibold text-[var(--warning)] tabular-nums"
            >~{{ pipDelta.changed }}</span
          >
          <span class="snap-pill-label opacity-70">{{ t('snapshots.pkgsLabel', 'pkgs') }}</span>
        </span>
      </div>
    </Button>

    <!-- Body card animates open/closed via BaseAccordion. -->
    <BaseAccordion :open="expanded">
      <div
        class="snapshot-row-card flex flex-col rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] px-3 py-2.5"
      >
        <!-- Composition totals; version omitted (already in the header pill). -->
        <div
          class="snapshot-row-meta flex flex-wrap items-center gap-1.5 px-1.5 py-px text-[11px] text-text-muted [overflow-wrap:anywhere]"
        >
          <span>{{ t('snapshots.nodesCount', { count: snapshot.nodeCount }) }}</span>
          <span class="snapshot-row-meta-dot opacity-50">·</span>
          <span>{{ t('snapshots.packagesCount', { count: snapshot.pipPackageCount }) }}</span>
        </div>
        <div
          class="snapshot-row-expanded mt-1 flex flex-col gap-2.5 border-t border-solid border-border-hover pt-3"
        >
          <slot name="expanded" />
        </div>
      </div>
    </BaseAccordion>
  </div>
</template>
