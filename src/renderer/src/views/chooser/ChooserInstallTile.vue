<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRightLeft,
  Info,
  LoaderCircle,
  MoreVertical
} from 'lucide-vue-next'
import { useSessionStore } from '../../stores/sessionStore'
import { progressOpKindForActionId } from '../../lib/progressOpKind'
import { installTypeMetaForInstall } from '../../lib/installTypeIcon'
import Tooltip from '../../components/ui/Tooltip.vue'
import TruncatedText from '../../components/TruncatedText.vue'
import { TID } from '../../../../shared/testIds'
import { isBuildInstall } from '../../devplatform/buildState'
import type { Installation } from '../../types/ipc'
import {
  chooserTileClass,
  chooserTileIconClass,
  chooserTileNameClass,
  chooserTilePillClass
} from './chooserTileClasses'

interface Props {
  installation: Installation
  showFreeRunsPill?: boolean
  showWhyCloud?: boolean
  /** Override runtime lifecycle presentation for surfaces that own separate sessions. */
  lifecycleStatus?: 'idle' | 'launching' | 'running' | 'stopping' | 'error'
  /** True when REQUIRES_STOPPED actions (update / migrate / restore / delete) are gated. */
  isStoppedActionGated: boolean
  /** True while Desktop captures this instance and creates its workspace draft. */
  isPromotingToWorkspace?: boolean
  /** Hide the card's context/kebab menu while keeping inline action pills enabled. */
  showMenu?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  lifecycleStatus: undefined,
  showMenu: true
})

const emit = defineEmits<{
  pick: [installation: Installation]
  'open-card-menu': [event: MouseEvent, installation: Installation]
  'open-kebab-menu': [event: MouseEvent, installation: Installation]
  'trigger-action': [action: 'update' | 'migrate', installation: Installation]
  'view-error': [installation: Installation]
  'view-danger': [installation: Installation]
  'why-cloud': []
}>()

const { t } = useI18n()
const sessionStore = useSessionStore()

const inst = computed(() => props.installation)

const isRunning = computed(() =>
  props.lifecycleStatus == null
    ? sessionStore.isRunning(inst.value.id)
    : props.lifecycleStatus === 'running'
)
const isLaunching = computed(() =>
  props.lifecycleStatus == null
    ? sessionStore.isLaunching(inst.value.id)
    : props.lifecycleStatus === 'launching'
)
const isStopping = computed(() =>
  props.lifecycleStatus == null
    ? sessionStore.isStopping(inst.value.id)
    : props.lifecycleStatus === 'stopping'
)
/* A managed update flips the record to status 'updating'; a standalone
 * update never touches the record and is only visible through main's
 * operation broadcast. Key on both so the tile reports "Updating" the same
 * way for either kind, regardless of which window started the update. */
const isUpdating = computed(() => {
  if (inst.value.status === 'updating') return true
  const op = sessionStore.operationInstances.get(inst.value.id)
  return op != null && progressOpKindForActionId(op.actionId) === 'update'
})
const hasError = computed(() =>
  props.lifecycleStatus == null
    ? sessionStore.errorInstances.has(inst.value.id)
    : props.lifecycleStatus === 'error'
)

/* Backend-flagged problem states (failed install, interrupted delete, missing
 * install folder) carry a `danger` statusTag. Surface it as a static red pill —
 * distinct from a live crash (`hasError`), which owns the clickable error badge. */
const dangerTag = computed(() =>
  inst.value.statusTag?.style === 'danger' ? inst.value.statusTag : null
)

const statusClasses = computed<Record<string, boolean>>(() => ({
  'chooser-tile-running': isRunning.value && !isStopping.value,
  'chooser-tile-stopping opacity-70': isStopping.value,
  'chooser-tile-updating cursor-wait': isUpdating.value,
  'chooser-tile-errored [--tile-border:var(--accent-danger,#d92d20)] shadow-[inset_0_0_0_1px_var(--accent-danger,#d92d20)]':
    hasError.value || dangerTag.value != null,
  '[--tile-border:var(--chooser-surface-border-hover)]':
    isRunning.value && !isStopping.value && !hasError.value && dangerTag.value == null
}))

/* Lifecycle → top-right status pill (dot + label). Stopping wins over
 * launching wins over running; an idle tile gets no pill. An errored
 * tile shows the clickable error badge instead (see template). */
const statusPill = computed<{ label: string; dotClass: string; spinning?: boolean } | null>(() => {
  if (props.isPromotingToWorkspace)
    return {
      label: 'devPlatform.workspace.promoting',
      dotClass: 'chooser-tile-status--promoting text-text-muted',
      spinning: true
    }
  if (isUpdating.value)
    return {
      label: 'instancePicker.progressUpdating',
      dotClass: 'chooser-tile-status--updating text-text-muted',
      spinning: true
    }
  if (isStopping.value)
    return {
      label: 'chooser.statusStopping',
      dotClass: 'chooser-tile-status--stopping text-[var(--accent-warning,#d97706)]'
    }
  if (isLaunching.value)
    return {
      label: 'chooser.statusLaunching',
      dotClass: 'chooser-tile-status--launching text-[var(--accent-warning,#d97706)]'
    }
  if (isRunning.value)
    return { label: 'chooser.statusRunning', dotClass: 'chooser-tile-status--running text-success' }
  return null
})

const showWhyCloudTrigger = computed(
  () => props.showWhyCloud && !hasError.value && !statusPill.value && !dangerTag.value
)

const hasUpdate = computed(() => inst.value.statusTag?.style === 'update')
// The backend tags every migratable install (Legacy Desktop, portable, git)
// with a `migrate` status tag — mirror `hasUpdate` rather than special-casing
// a single source.
const hasMigratePrompt = computed(() => inst.value.statusTag?.style === 'migrate')

const typeMeta = computed(() => installTypeMetaForInstall(inst.value))

/** Wears the build glyph rather than its install-type icon, so a build keeps
 *  one identity whether it's installed or still a card. */
const isFromBuild = computed(() => isBuildInstall(inst.value))

const buildVersion = computed(() =>
  typeof inst.value.distributionVersion === 'string' ? inst.value.distributionVersion : ''
)

/** Desktop's listPreview is the bare installPath (useless as a label), so fall
 *  back to sourceLabel. Cloud/remote values are URLs — strip the protocol. */
const sourceLabel = computed(() => {
  // The path is noise on a tile whose identity is the build.
  if (isFromBuild.value) return ''
  const raw =
    inst.value.sourceId === 'desktop'
      ? inst.value.sourceLabel
      : inst.value.listPreview || inst.value.sourceLabel
  return raw ? raw.replace(/^https?:\/\//, '') : raw
})

/** Labelled ("Build v7") so it can't be read as the ComfyUI version beside it. */
const trailingFact = computed(() =>
  isFromBuild.value
    ? buildVersion.value
      ? t('devPlatform.build.version', { version: buildVersion.value })
      : ''
    : inst.value.version || ''
)

/** Build installs show the ComfyUI version followed by the Build version;
 *  everything else shows the source followed by its version. */
const leadingFact = computed(() =>
  isFromBuild.value ? inst.value.version || '' : sourceLabel.value
)

const metaLine = computed(() => [leadingFact.value, trailingFact.value].filter(Boolean).join(' · '))

/** The single update/migrate affordance, or null when the install has neither.
 *  The Update tooltip surfaces the target version the bare pill hides. */
const actionPill = computed(() => {
  if (isUpdating.value) return null
  if (hasUpdate.value)
    return {
      action: 'update' as const,
      icon: ArrowDownToLine,
      label: t('chooser.updatePill'),
      tooltip: inst.value.statusTag?.label || t('chooser.updatePill')
    }
  if (hasMigratePrompt.value)
    return {
      action: 'migrate' as const,
      icon: ArrowRightLeft,
      label: t('chooser.migratePill'),
      tooltip: t('dashboard.migrateBannerTitle')
    }
  return null
})

function handleClick(): void {
  if (isStopping.value || isUpdating.value) return
  emit('pick', inst.value)
}

function handleContextMenu(event: MouseEvent): void {
  if (!props.showMenu || isUpdating.value) return
  emit('open-card-menu', event, inst.value)
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
    :tabindex="isUpdating ? -1 : 0"
    :aria-disabled="isUpdating || undefined"
    class="chooser-tile chooser-tile--install"
    :class="[chooserTileClass, statusClasses]"
    :data-testid="TID.dashboardTile(inst.id)"
    :data-source-category="inst.sourceCategory"
    @click="handleClick"
    @keydown.enter="handleClick"
    @keydown.space.prevent="handleClick"
    @contextmenu.prevent="handleContextMenu"
  >
    <!-- Type icon only; source/channel lives in the meta line below. A
         build install wears the build glyph instead. -->
    <span class="chooser-tile-icon" :class="chooserTileIconClass" :title="t(typeMeta.labelKey)">
      <!-- `typeMeta` resolves the build glyph itself, so the tile, the
           picker row and the title bar can't drift apart. -->
      <component :is="typeMeta.icon" :size="22" />
    </span>

    <!-- Lifecycle indicator + kebab. Status pill is click-through; error badge opens details. -->
    <div class="chooser-tile-actions absolute top-2 right-2 z-1 flex items-center gap-1">
      <span
        v-if="props.showFreeRunsPill && !hasError && !statusPill && !dangerTag"
        class="chooser-cloud-runs-pill inline-flex shrink-0 items-center rounded-[999px] bg-comfy-yellow px-2 py-[3px] text-[10px] [line-height:normal] font-bold tracking-[0.02em] whitespace-nowrap text-neutral-900 uppercase"
        data-testid="chooser-cloud-runs-pill"
        >{{ $t('firstUse.cloudFreeRunsPill') }}</span
      >
      <Button
        v-if="hasError"
        variant="destructive-textonly"
        size="sm"
        type="button"
        class="chooser-tile-error-badge rounded-full"
        :title="t('chooser.viewErrorTooltip')"
        @click.stop="emit('view-error', inst)"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <AlertCircle :size="14" />
        {{ t('chooser.statusError') }}
      </Button>
      <span
        v-else-if="statusPill"
        class="chooser-tile-pill chooser-tile-status border-[var(--border-subtle,rgba(127,127,127,0.18))] bg-[var(--bg-elev-2,rgba(127,127,127,0.14))] pointer-events-none shrink-0 gap-1.5 opacity-100"
        :class="[chooserTilePillClass, statusPill.dotClass]"
      >
        <LoaderCircle
          v-if="statusPill.spinning"
          :size="12"
          class="chooser-tile-status-spinner shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
          aria-hidden="true"
        />
        <span
          v-else
          class="chooser-tile-status-dot size-2 shrink-0 rounded-[999px] bg-current"
          :class="{
            'animate-[chooser-tile-status-pulse_1.2s_ease-in-out_infinite] motion-reduce:animate-none':
              isLaunching
          }"
          aria-hidden="true"
        />
        {{ t(statusPill.label) }}
      </span>
      <Button
        v-else-if="dangerTag"
        variant="destructive-textonly"
        size="sm"
        type="button"
        class="chooser-tile-danger-tag rounded-full"
        :title="t('chooser.viewErrorTooltip')"
        @click.stop="emit('view-danger', inst)"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <AlertCircle :size="13" />
        {{ dangerTag.label }}
      </Button>
      <Button
        v-if="props.showMenu && !isUpdating"
        variant="muted-textonly"
        size="icon-sm"
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
      </Button>
    </div>

    <!-- Two lines: name, then one row with the meta facts left and the
         action pill (update / migrate) pinned right. -->
    <div class="chooser-tile-body mt-auto flex w-full min-w-0 flex-col gap-1">
      <div
        class="chooser-tile-name-row flex min-w-0 items-center gap-1.5 [&_.tooltip-wrap]:flex-none"
      >
        <TruncatedText
          class="chooser-tile-name mt-0 [&.tooltip-wrap]:block"
          :class="chooserTileNameClass"
          :text="inst.name"
        />
        <Tooltip v-if="showWhyCloudTrigger" class="flex-none" :text="t('firstUse.whyTryCloud')">
          <Button
            variant="muted-textonly"
            size="icon-sm"
            type="button"
            class="chooser-tile-why-cloud flex-none"
            :aria-label="t('firstUse.whyTryCloud')"
            :data-testid="TID.dashboardTileWhyCloud(inst.id)"
            @click.stop="emit('why-cloud')"
            @keydown.enter.stop
            @keydown.space.stop
          >
            <Info :size="14" />
          </Button>
        </Tooltip>
      </div>
      <div
        v-if="metaLine || actionPill"
        class="chooser-tile-footer flex w-full min-w-0 items-center gap-2"
      >
        <TruncatedText
          v-if="metaLine"
          class="chooser-tile-meta-line [&.tooltip-wrap]:block min-w-0 max-w-full text-[12px] text-[var(--text-faint)] group-hover/tile:text-text-muted group-focus-visible/tile:text-text-muted"
          :text="metaLine"
        >
          <span
            v-if="leadingFact"
            class="chooser-tile-meta-source text-[var(--text-faint)] group-hover/tile:text-text-muted group-focus-visible/tile:text-text-muted"
            >{{ leadingFact }}</span
          >
          <span
            v-if="leadingFact && trailingFact"
            class="chooser-tile-meta-sep mx-[5px] text-[var(--text-faint)] group-hover/tile:text-text-muted group-focus-visible/tile:text-text-muted"
            >·</span
          >
          <span
            v-if="trailingFact"
            class="chooser-tile-meta-version font-medium text-text-muted group-hover/tile:text-text group-focus-visible/tile:text-text"
            >{{ trailingFact }}</span
          >
        </TruncatedText>
        <!-- Action pill; pinned right by its own margin, never truncates. -->
        <Tooltip
          v-if="actionPill"
          :text="actionPill.tooltip"
          class="chooser-tile-pill-action ml-auto shrink-0"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="chooser-tile-pill shrink-0 rounded-full"
            :class="{
              'chooser-tile-pill-update': actionPill.action === 'update',
              'chooser-tile-pill-migrate': actionPill.action === 'migrate',
              'chooser-tile-pill-disabled opacity-45': isStoppedActionGated
            }"
            :aria-disabled="isStoppedActionGated || undefined"
            @click.stop="triggerInstallAction(actionPill.action)"
            @keydown.enter.stop
            @keydown.space.stop
          >
            <component :is="actionPill.icon" :size="11" />
            {{ actionPill.label }}
          </Button>
        </Tooltip>
      </div>
    </div>
  </div>
</template>

<style>
/* The launching dot pulses independently of the tile's FLIP transform. */
@keyframes chooser-tile-status-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
