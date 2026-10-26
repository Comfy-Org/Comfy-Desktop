<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { AlertCircle, LoaderCircle } from 'lucide-vue-next'
import Badge from '../design-system/components/Badge.vue'
import StatusDot from '../design-system/components/StatusDot.vue'
import { badgeVariants } from '../design-system/components/badge.variants'
import { cn } from '../design-system/cn'
import Tooltip from './ui/Tooltip.vue'
import { useInstallTileState } from '../composables/useInstallTileState'
import type { InstallLifecycleStatus } from '../composables/useInstallTileState'
import type { Installation } from '../types/ipc'

/**
 * The badges a dashboard card shows next to its menu: TRY FREE, an error
 * (opens its details), the lifecycle status, a backend problem tag, and the
 * one update / migrate action. `showStatus` off when the card shows the
 * status elsewhere.
 */
const props = defineProps<{
  installation: Installation
  showFreeRunsPill?: boolean
  showStatus?: boolean
  /** True when REQUIRES_STOPPED actions (update / migrate / restore / delete) are gated. */
  isStoppedActionGated: boolean
  isPromotingToWorkspace?: boolean
  lifecycleStatus?: InstallLifecycleStatus
}>()

const emit = defineEmits<{
  'trigger-action': [action: 'update' | 'migrate', installation: Installation]
  'view-error': [installation: Installation]
  'view-danger': [installation: Installation]
}>()

const { t } = useI18n()
const { inst, hasError, statusPill, dangerTag, actionPill } = useInstallTileState({
  installation: () => props.installation,
  lifecycleStatus: () => props.lifecycleStatus,
  isPromotingToWorkspace: () => props.isPromotingToWorkspace
})

/** Fire an action pill's emit, no-op while REQUIRES_STOPPED actions are gated. */
function triggerInstallAction(action: 'update' | 'migrate'): void {
  if (props.isStoppedActionGated) return
  emit('trigger-action', action, inst.value)
}
</script>

<template>
  <Badge
    v-if="showFreeRunsPill && !hasError && !statusPill && !dangerTag"
    variant="outline"
    class="chooser-cloud-runs-pill"
    data-testid="chooser-cloud-runs-pill"
    >{{ $t('firstUse.cloudFreeRunsPill') }}</Badge
  >
  <button
    v-if="hasError"
    type="button"
    :class="
      cn(
        badgeVariants({ variant: 'danger' }),
        'chooser-tile-error-badge outline-none focus-visible:ring-2 focus-visible:ring-border-focus'
      )
    "
    :title="t('chooser.viewErrorTooltip')"
    @click.stop="emit('view-error', inst)"
    @keydown.enter.stop
    @keydown.space.stop
  >
    <AlertCircle :size="12" />
    {{ t('chooser.statusError') }}
  </button>
  <Badge
    v-else-if="statusPill && showStatus"
    class="chooser-tile-pill chooser-tile-status"
    :class="statusPill.dotClass"
  >
    <LoaderCircle
      v-if="statusPill.spinning"
      :size="11"
      class="chooser-tile-status-spinner animate-spin motion-reduce:animate-none"
      aria-hidden="true"
    />
    <StatusDot v-else :status="statusPill.running ? 'running' : 'busy'" />
    {{ t(statusPill.label) }}
  </Badge>
  <button
    v-else-if="dangerTag"
    type="button"
    :class="
      cn(
        badgeVariants({ variant: 'danger' }),
        'chooser-tile-danger-tag max-w-full min-w-0 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-border-focus'
      )
    "
    :title="t('chooser.viewErrorTooltip')"
    @click.stop="emit('view-danger', inst)"
    @keydown.enter.stop
    @keydown.space.stop
  >
    <AlertCircle :size="12" class="shrink-0" />
    <span class="truncate">{{ dangerTag.label }}</span>
  </button>
  <Tooltip v-if="actionPill" :text="actionPill.tooltip" class="chooser-tile-pill-action">
    <span
      :class="
        cn(
          badgeVariants(),
          'chooser-tile-pill text-base-foreground outline-none hover:bg-secondary-background-hover focus-visible:ring-2 focus-visible:ring-border-focus',
          actionPill.pillClass,
          isStoppedActionGated && 'chooser-tile-pill-disabled cursor-not-allowed opacity-40'
        )
      "
      role="button"
      tabindex="0"
      :aria-disabled="isStoppedActionGated || undefined"
      @click.stop="triggerInstallAction(actionPill.action)"
      @keydown.enter.stop="triggerInstallAction(actionPill.action)"
      @keydown.space.prevent.stop="triggerInstallAction(actionPill.action)"
    >
      <component :is="actionPill.icon" :size="11" />
      {{ actionPill.label }}
    </span>
  </Tooltip>
</template>
