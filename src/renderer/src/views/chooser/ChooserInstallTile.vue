<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, ArrowDownToLine, ArrowRightLeft, MoreVertical } from 'lucide-vue-next'
import { useSessionStore } from '../../stores/sessionStore'
import { installTypeMetaForInstall } from '../../lib/installTypeIcon'
import Tooltip from '../../components/ui/Tooltip.vue'
import TruncatedText from '../../components/TruncatedText.vue'
import { TID } from '../../../../shared/testIds'
import type { Installation } from '../../types/ipc'

interface Props {
  installation: Installation
  /** True when REQUIRES_STOPPED actions (update / migrate / restore / delete) are gated. */
  isStoppedActionGated: boolean
  /** Pre-formatted recency label — "Launched 3h ago" / "Not launched yet". */
  lastLaunchedLabel: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  pick: [installation: Installation]
  'open-card-menu': [event: MouseEvent, installation: Installation]
  'open-kebab-menu': [event: MouseEvent, installation: Installation]
  'trigger-action': [action: 'update' | 'migrate', installation: Installation]
  'view-error': [installation: Installation]
  'view-danger': [installation: Installation]
}>()

const { t } = useI18n()
const sessionStore = useSessionStore()

const inst = computed(() => props.installation)

const isRunning = computed(() => sessionStore.isRunning(inst.value.id))
const isLaunching = computed(() => sessionStore.isLaunching(inst.value.id))
const isStopping = computed(() => sessionStore.isStopping(inst.value.id))
const hasError = computed(() => sessionStore.errorInstances.has(inst.value.id))

/* Backend-flagged problem states (failed install, interrupted delete, missing
 * install folder) carry a `danger` statusTag. Surface it as a static red pill —
 * distinct from a live crash (`hasError`), which owns the clickable error badge. */
const dangerTag = computed(() =>
  inst.value.statusTag?.style === 'danger' ? inst.value.statusTag : null
)

const statusClasses = computed<Record<string, boolean>>(() => ({
  'chooser-tile-running': isRunning.value && !isStopping.value,
  'chooser-tile-stopping': isStopping.value,
  'chooser-tile-errored': hasError.value || dangerTag.value != null
}))

/* Lifecycle → top-right status pill (dot + label). Stopping wins over
 * launching wins over running; an idle tile gets no pill. An errored
 * tile shows the clickable error badge instead (see template). */
const statusPill = computed<{ label: string; dotClass: string } | null>(() => {
  if (isStopping.value)
    return { label: 'chooser.statusStopping', dotClass: 'chooser-tile-status--stopping' }
  if (isLaunching.value)
    return { label: 'chooser.statusLaunching', dotClass: 'chooser-tile-status--launching' }
  if (isRunning.value)
    return { label: 'chooser.statusRunning', dotClass: 'chooser-tile-status--running' }
  return null
})

const hasUpdate = computed(() => inst.value.statusTag?.style === 'update')
// The backend tags every migratable install (Legacy Desktop, portable, git)
// with a `migrate` status tag — mirror `hasUpdate` rather than special-casing
// a single source.
const hasMigratePrompt = computed(() => inst.value.statusTag?.style === 'migrate')

const typeMeta = computed(() => installTypeMetaForInstall(inst.value))

/** Desktop's listPreview is the bare installPath (useless as a label), so fall
 *  back to sourceLabel. Cloud/remote values are URLs — strip the protocol. */
const sourceLabel = computed(() => {
  const raw =
    inst.value.sourceId === 'desktop'
      ? inst.value.sourceLabel
      : inst.value.listPreview || inst.value.sourceLabel
  return raw ? raw.replace(/^https?:\/\//, '') : raw
})

const metaLine = computed(() =>
  [sourceLabel.value, inst.value.version].filter(Boolean).join(' · ')
)


/** The single update/migrate affordance, or null when the install has neither.
 *  The Update tooltip surfaces the target version the bare pill hides. */
const actionPill = computed(() => {
  if (hasUpdate.value)
    return {
      action: 'update' as const,
      icon: ArrowDownToLine,
      label: t('chooser.updatePill'),
      tooltip: inst.value.statusTag?.label || t('chooser.updatePill'),
      pillClass: 'chooser-tile-pill-update'
    }
  if (hasMigratePrompt.value)
    return {
      action: 'migrate' as const,
      icon: ArrowRightLeft,
      label: t('chooser.migratePill'),
      tooltip: t('dashboard.migrateBannerTitle'),
      pillClass: 'chooser-tile-pill-migrate'
    }
  return null
})

/** Precise fallback for the relative recency label; empty when never booted. */
const absoluteLaunchedTime = computed(() => {
  const ts = inst.value.lastLaunchedAt
  return typeof ts === 'number'
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ts)
    : ''
})

function handleClick(): void {
  if (isStopping.value) return
  emit('pick', inst.value)
}

/** Fire an action pill's emit, no-op while REQUIRES_STOPPED actions are gated.
 *  Shared by the update + migrate pills' click / enter / space handlers. */
function triggerInstallAction(action: 'update' | 'migrate'): void {
  if (props.isStoppedActionGated) return
  emit('trigger-action', action, inst.value)
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="chooser-tile chooser-tile--install"
    :class="statusClasses"
    :data-testid="TID.dashboardTile(inst.id)"
    :data-source-category="inst.sourceCategory"
    @click="handleClick"
    @keydown.enter="handleClick"
    @keydown.space.prevent="handleClick"
    @contextmenu.prevent="emit('open-card-menu', $event, inst)"
  >
    <!-- Type icon only; source/channel lives in the meta line below. -->
    <span class="chooser-tile-icon" :title="t(typeMeta.labelKey)">
      <component :is="typeMeta.icon" :size="22" />
    </span>

    <!-- Lifecycle indicator + kebab. Status pill is click-through; error badge opens details. -->
    <div class="chooser-tile-actions">
      <button
        v-if="hasError"
        type="button"
        class="chooser-tile-error-badge"
        :title="t('chooser.viewErrorTooltip')"
        @click.stop="emit('view-error', inst)"
        @keydown.enter.stop="emit('view-error', inst)"
        @keydown.space.stop
      >
        <AlertCircle :size="14" />
        {{ t('chooser.statusError') }}
      </button>
      <span
        v-else-if="statusPill"
        class="chooser-tile-pill chooser-tile-status"
        :class="statusPill.dotClass"
      >
        <span class="chooser-tile-status-dot" aria-hidden="true" />
        {{ t(statusPill.label) }}
      </span>
      <button
        v-else-if="dangerTag"
        type="button"
        class="chooser-tile-danger-tag"
        :title="t('chooser.viewErrorTooltip')"
        @click.stop="emit('view-danger', inst)"
        @keydown.enter.stop="emit('view-danger', inst)"
        @keydown.space.stop
      >
        <AlertCircle :size="13" />
        {{ dangerTag.label }}
      </button>
      <button
        type="button"
        class="chooser-tile-kebab"
        :title="t('chooser.moreActions')"
        :aria-label="t('chooser.moreActions')"
        :data-testid="TID.dashboardTileKebab(inst.id)"
        @click.stop="emit('open-kebab-menu', $event, inst)"
        @contextmenu.stop="emit('open-kebab-menu', $event, inst)"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <MoreVertical :size="16" />
      </button>
    </div>

    <!-- Stacked tiers (name → meta → recency); each truncates on its own row. -->
    <div class="chooser-tile-body">
      <TruncatedText class="chooser-tile-name" :text="inst.name" />
      <TruncatedText v-if="metaLine" class="chooser-tile-meta-line" :text="metaLine">
        <span v-if="sourceLabel" class="chooser-tile-meta-source">{{ sourceLabel }}</span>
        <span v-if="sourceLabel && inst.version" class="chooser-tile-meta-sep">·</span>
        <span v-if="inst.version" class="chooser-tile-meta-version">{{ inst.version }}</span>
      </TruncatedText>
      <div class="chooser-tile-footer">
        <Tooltip
          class="chooser-tile-recency"
          :text="absoluteLaunchedTime"
          :disabled="!absoluteLaunchedTime"
        >
          <span class="chooser-tile-recency-text">{{ lastLaunchedLabel }}</span>
        </Tooltip>
        <!-- Action pill (update / migrate); pinned right, never truncates. -->
        <Tooltip v-if="actionPill" :text="actionPill.tooltip" class="chooser-tile-pill-action">
          <span
            class="chooser-tile-pill"
            :class="[actionPill.pillClass, { 'chooser-tile-pill-disabled': isStoppedActionGated }]"
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
      </div>
    </div>
  </div>
</template>

<style scoped>
@import './chooser-tiles.css';
</style>
