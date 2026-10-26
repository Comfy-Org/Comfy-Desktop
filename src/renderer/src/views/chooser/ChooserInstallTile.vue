<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRightLeft,
  EllipsisVertical,
  Info,
  LoaderCircle,
  Play,
  SquareArrowOutUpRight
} from 'lucide-vue-next'
import { useSessionStore } from '../../stores/sessionStore'
import { progressOpKindForActionId } from '../../lib/progressOpKind'
import { installTypeMetaForInstall } from '../../lib/installTypeIcon'
import Tooltip from '../../components/ui/Tooltip.vue'
import TruncatedText from '../../components/TruncatedText.vue'
import Badge from '../../design-system/components/Badge.vue'
import Button from '../../design-system/components/Button.vue'
import Card from '../../design-system/components/Card.vue'
import LocationIcon from '../../design-system/components/LocationIcon.vue'
import StatusDot from '../../design-system/components/StatusDot.vue'
import { badgeVariants } from '../../design-system/components/badge.variants'
import { cn } from '../../design-system/cn'
import { TID } from '../../../../shared/testIds'
import { isBuildInstall } from '../../devplatform/buildState'
import type { Installation } from '../../types/ipc'

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
  'chooser-tile-stopping': isStopping.value,
  'chooser-tile-updating': isUpdating.value,
  'chooser-tile-errored': hasError.value || dangerTag.value != null
}))

/* Lifecycle → top-right status pill (dot + label). Stopping wins over
 * launching wins over running; an idle tile gets no pill. An errored
 * tile shows the clickable error badge instead (see template). */
const statusPill = computed<{
  label: string
  dotClass: string
  spinning?: boolean
  running?: boolean
} | null>(() => {
  if (props.isPromotingToWorkspace)
    return {
      label: 'devPlatform.workspace.promoting',
      dotClass: 'chooser-tile-status--promoting',
      spinning: true
    }
  if (isUpdating.value)
    return {
      label: 'instancePicker.progressUpdating',
      dotClass: 'chooser-tile-status--updating',
      spinning: true
    }
  if (isStopping.value)
    return { label: 'chooser.statusStopping', dotClass: 'chooser-tile-status--stopping' }
  if (isLaunching.value)
    return { label: 'chooser.statusLaunching', dotClass: 'chooser-tile-status--launching' }
  if (isRunning.value)
    return {
      label: 'chooser.statusRunning',
      dotClass: 'chooser-tile-status--running',
      running: true
    }
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

/** The hover button repeats the tile's own click, labelled with what it does. */
const launchLabel = computed(() =>
  isRunning.value || isLaunching.value ? t('chooser.openInstall') : t('actions.launch')
)
const canLaunch = computed(() => !isStopping.value && !isUpdating.value)

function handleClick(): void {
  if (!canLaunch.value) return
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
  <Card
    variant="elevated"
    padding="md"
    interactive
    role="button"
    :tabindex="isUpdating ? -1 : 0"
    :aria-disabled="isUpdating || undefined"
    class="chooser-tile chooser-tile--install group flex min-w-0 flex-col gap-3.5"
    :class="statusClasses"
    :data-testid="TID.dashboardTile(inst.id)"
    :data-source-category="inst.sourceCategory"
    @click="handleClick"
    @keydown.enter="handleClick"
    @keydown.space.prevent="handleClick"
    @contextmenu.prevent="handleContextMenu"
  >
    <div class="flex items-start justify-between gap-2">
      <!-- Where it runs; the install type is in the meta line and the tooltip. -->
      <span class="chooser-tile-icon inline-flex" :title="t(typeMeta.labelKey)">
        <LocationIcon :kind="inst.sourceCategory === 'cloud' ? 'cloud' : 'local'" :size="28" />
      </span>

      <!-- Lifecycle indicator, update / migrate action and kebab. Status pill is
         click-through; error badge opens details. -->
      <div class="chooser-tile-actions flex min-w-0 items-center gap-1">
        <Badge
          v-if="props.showFreeRunsPill && !hasError && !statusPill && !dangerTag"
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
          @keydown.enter.stop="emit('view-error', inst)"
          @keydown.space.stop
        >
          <AlertCircle :size="12" />
          {{ t('chooser.statusError') }}
        </button>
        <Badge
          v-else-if="statusPill"
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
          @keydown.enter.stop="emit('view-danger', inst)"
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
        <Button
          v-if="props.showMenu && !isUpdating"
          variant="ghost"
          size="icon-sm"
          class="chooser-tile-kebab"
          :title="t('chooser.moreActions')"
          :aria-label="t('chooser.moreActions')"
          :data-testid="TID.dashboardTileKebab(inst.id)"
          @click.stop="emit('open-kebab-menu', $event, inst)"
          @contextmenu.stop="emit('open-kebab-menu', $event, inst)"
          @keydown.enter.stop
          @keydown.space.stop
        >
          <EllipsisVertical :size="14" />
        </Button>
      </div>
    </div>

    <!-- Name, then the meta facts. -->
    <div class="chooser-tile-body min-w-0">
      <div class="chooser-tile-name-row flex min-w-0 items-center gap-1.5">
        <TruncatedText
          class="chooser-tile-name min-w-0 text-heading font-semibold"
          :text="inst.name"
        />
        <Tooltip v-if="showWhyCloudTrigger" :text="t('firstUse.whyTryCloud')">
          <Button
            variant="ghost"
            size="icon-xs"
            class="chooser-tile-why-cloud"
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
      <TruncatedText
        v-if="metaLine"
        class="chooser-tile-meta-line max-w-full min-w-0 text-ui text-muted-foreground"
        :text="metaLine"
      >
        <span v-if="leadingFact" class="chooser-tile-meta-source">{{ leadingFact }}</span>
        <span v-if="leadingFact && trailingFact" class="chooser-tile-meta-sep"> · </span>
        <span v-if="trailingFact" class="chooser-tile-meta-version">{{ trailingFact }}</span>
      </TruncatedText>
    </div>

    <!-- Launch on hover; the tile itself launches on click too. -->
    <div class="chooser-tile-footer mt-auto flex min-h-7 items-center justify-end">
      <Button
        v-if="canLaunch"
        size="sm"
        tabindex="-1"
        class="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        @click.stop="handleClick"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <SquareArrowOutUpRight v-if="isRunning" :size="12" />
        <Play v-else :size="12" />
        {{ launchLabel }}
      </Button>
    </div>
  </Card>
</template>
