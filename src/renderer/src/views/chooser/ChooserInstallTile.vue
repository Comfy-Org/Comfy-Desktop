<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowRightLeft,
  ArrowUpCircle,
  Ellipsis,
  Info,
  LoaderCircle,
  OctagonAlert
} from 'lucide-vue-next'
import { useSessionStore } from '../../stores/sessionStore'
import { progressOpKindForActionId } from '../../lib/progressOpKind'
import { installTypeMetaForInstall } from '../../lib/installTypeIcon'
import Tooltip from '../../components/ui/Tooltip.vue'
import TruncatedText from '../../components/TruncatedText.vue'
import { TID } from '../../../../shared/testIds'
import { isBuildInstall } from '../../devplatform/buildState'
import type { Installation } from '../../types/ipc'

interface Props {
  installation: Installation
  showFreeRunsPill?: boolean
  showWhyCloud?: boolean
  lifecycleStatus?: 'idle' | 'launching' | 'running' | 'stopping' | 'error'
  isStoppedActionGated: boolean
  isPromotingToWorkspace?: boolean
  showMenu?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  lifecycleStatus: undefined,
  showMenu: true
})

const emit = defineEmits<{
  pick: [installation: Installation]
  'open-details': [installation: Installation]
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

const dangerTag = computed(() =>
  inst.value.statusTag?.style === 'danger' ? inst.value.statusTag : null
)

const statusClasses = computed<Record<string, boolean>>(() => ({
  'chooser-tile-running': isRunning.value && !isStopping.value,
  'chooser-tile-stopping opacity-70': isStopping.value,
  'chooser-tile-updating cursor-wait': isUpdating.value,
  'chooser-tile-errored': hasError.value || dangerTag.value != null
}))

const statusPill = computed<{
  label: string
  markerClass: string
  tone: 'go' | 'quiet'
  spinning?: boolean
} | null>(() => {
  if (props.isPromotingToWorkspace)
    return {
      label: 'devPlatform.workspace.promoting',
      markerClass: 'chooser-tile-status--promoting',
      tone: 'quiet',
      spinning: true
    }
  if (isUpdating.value)
    return {
      label: 'instancePicker.progressUpdating',
      markerClass: 'chooser-tile-status--updating',
      tone: 'quiet',
      spinning: true
    }
  if (isStopping.value)
    return {
      label: 'chooser.statusStopping',
      markerClass: 'chooser-tile-status--stopping',
      tone: 'quiet'
    }
  if (isLaunching.value)
    return {
      label: 'chooser.statusLaunching',
      markerClass: 'chooser-tile-status--launching',
      tone: 'quiet',
      spinning: true
    }
  if (isRunning.value)
    return {
      label: 'chooser.statusRunning',
      markerClass: 'chooser-tile-status--running',
      tone: 'go'
    }
  if (inst.value.sourceCategory === 'local' && !hasError.value && !dangerTag.value)
    return {
      label: 'chooser.statusStopped',
      markerClass: 'chooser-tile-status--stopped',
      tone: 'quiet'
    }
  return null
})

const showWhyCloudTrigger = computed(
  () => props.showWhyCloud && !hasError.value && !statusPill.value && !dangerTag.value
)

const hasUpdate = computed(() => inst.value.statusTag?.style === 'update')
const hasMigratePrompt = computed(() => inst.value.statusTag?.style === 'migrate')

const typeMeta = computed(() => installTypeMetaForInstall(inst.value))

const isFromBuild = computed(() => isBuildInstall(inst.value))

const buildVersion = computed(() =>
  typeof inst.value.distributionVersion === 'string' ? inst.value.distributionVersion : ''
)

const sourceLabel = computed(() => {
  if (isFromBuild.value) return ''
  const raw =
    inst.value.sourceId === 'desktop'
      ? inst.value.sourceLabel
      : inst.value.listPreview || inst.value.sourceLabel
  return raw ? raw.replace(/^https?:\/\//, '') : raw
})

const trailingFact = computed(() =>
  isFromBuild.value
    ? buildVersion.value
      ? t('devPlatform.build.version', { version: buildVersion.value })
      : ''
    : inst.value.version || ''
)

const leadingFact = computed(() =>
  isFromBuild.value ? inst.value.version || '' : sourceLabel.value
)

const metaLine = computed(() => [leadingFact.value, trailingFact.value].filter(Boolean).join(' · '))

const actionPill = computed(() => {
  if (isUpdating.value) return null
  if (hasUpdate.value)
    return {
      action: 'update' as const,
      icon: ArrowUpCircle,
      label: t('chooser.updateAvailable'),
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

const showLaunch = computed(
  () => !isUpdating.value && !isStopping.value && !props.isPromotingToWorkspace
)
const opensExisting = computed(
  () =>
    isRunning.value ||
    isLaunching.value ||
    hasError.value ||
    inst.value.sourceCategory === 'cloud' ||
    inst.value.sourceCategory === 'remote'
)

const launchLabel = computed(() => {
  if (inst.value.sourceCategory === 'cloud') return t('chooser.openOnCloud')
  if (inst.value.sourceCategory === 'remote') return t('chooser.openOnRemote')
  return opensExisting.value ? t('chooser.openOnThisComputer') : t('chooser.startOnThisComputer')
})

function openDetails(): void {
  if (isStopping.value || isUpdating.value) return
  emit('open-details', inst.value)
}

function launch(): void {
  if (isStopping.value || isUpdating.value) return
  emit('pick', inst.value)
}

function handleContextMenu(event: MouseEvent): void {
  if (!props.showMenu || isUpdating.value) return
  emit('open-card-menu', event, inst.value)
}

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
    class="chooser-tile chooser-tile--install group/tile col-span-full grid h-14 min-w-0 cursor-pointer grid-cols-subgrid items-center rounded-card bg-card/72 pr-3 pl-4 outline-none transition-[background-color,box-shadow] duration-160 select-none hover:bg-card-hover/80 focus-visible:shadow-[0_0_0_2px_var(--color-ring)]"
    :class="statusClasses"
    :data-testid="TID.dashboardTile(inst.id)"
    :data-source-category="inst.sourceCategory"
    @click="openDetails"
    @keydown.enter="openDetails"
    @keydown.space.prevent="openDetails"
    @contextmenu.prevent="handleContextMenu"
  >
    <div
      class="chooser-tile-body chooser-tile-name-row flex min-w-0 items-center gap-3 [&_.tooltip-wrap]:min-w-0 [&_.tooltip-wrap]:flex-none"
    >
      <component
        :is="typeMeta.icon"
        :size="16"
        class="chooser-tile-icon shrink-0 text-muted-foreground"
        :aria-label="t(typeMeta.labelKey)"
      />
      <div class="flex min-w-0 items-center gap-3">
        <TruncatedText
          class="chooser-tile-name block min-w-0 shrink text-[14px]/5 font-semibold text-foreground [&.tooltip-wrap]:block"
          :text="inst.name"
        />
        <TruncatedText
          v-if="metaLine"
          class="chooser-tile-meta-line block min-w-0 shrink-[2] text-[13px]/5 text-muted-foreground [&.tooltip-wrap]:block"
          :text="metaLine"
        />
      </div>
      <Button
        v-if="hasError"
        variant="destructive-textonly"
        size="unset"
        type="button"
        class="chooser-tile-error-badge h-5 shrink-0 gap-1 rounded-sm bg-destructive/16 px-1.5 text-[12px] leading-none font-medium hover:bg-destructive/25"
        :title="t('chooser.viewErrorTooltip')"
        @click.stop="emit('view-error', inst)"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <OctagonAlert :size="12" />
        {{ t('chooser.statusError') }}
      </Button>
      <Button
        v-else-if="dangerTag"
        variant="destructive-textonly"
        size="unset"
        type="button"
        class="chooser-tile-danger-tag h-5 min-w-0 gap-1 rounded-sm bg-destructive/16 px-1.5 text-[12px] leading-none font-medium hover:bg-destructive/25"
        :title="t('chooser.viewErrorTooltip')"
        @click.stop="emit('view-danger', inst)"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <OctagonAlert :size="12" />
        <span class="truncate">{{ dangerTag.label }}</span>
      </Button>
      <Tooltip
        v-else-if="actionPill"
        :text="actionPill.tooltip"
        class="chooser-tile-pill-action shrink-0"
      >
        <Button
          type="button"
          variant="textonly"
          size="unset"
          class="chooser-tile-pill h-5 gap-1 rounded-sm bg-warning/15 px-1.5 text-[12px] leading-none font-medium text-warning hover:bg-warning/25"
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
          <component :is="actionPill.icon" :size="12" />
          {{ actionPill.label }}
        </Button>
      </Tooltip>
      <span
        v-if="props.showFreeRunsPill && !hasError && !statusPill && !dangerTag"
        class="chooser-cloud-runs-pill inline-flex shrink-0 items-center rounded-full bg-foreground px-2 py-[3px] text-[10px] [line-height:normal] font-bold tracking-[0.02em] whitespace-nowrap text-background uppercase"
        data-testid="chooser-cloud-runs-pill"
        >{{ $t('firstUse.cloudFreeRunsPill') }}</span
      >
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

    <span
      v-if="statusPill"
      class="chooser-tile-status pointer-events-none inline-flex items-center gap-2 text-[13px]/5 whitespace-nowrap"
      :class="[
        statusPill.markerClass,
        statusPill.tone === 'go' ? 'text-success' : 'text-foreground'
      ]"
    >
      <LoaderCircle
        v-if="statusPill.spinning"
        :size="12"
        class="chooser-tile-status-spinner shrink-0 animate-spin text-muted-foreground [animation-duration:900ms] motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span
        v-else
        class="size-2 shrink-0 rounded-full"
        :class="
          statusPill.tone === 'go'
            ? 'animate-status-breathe bg-current motion-reduce:animate-none'
            : 'bg-muted-foreground'
        "
        aria-hidden="true"
      />
      {{ t(statusPill.label) }}
    </span>
    <span v-else />

    <div class="chooser-tile-actions flex items-center justify-end gap-2">
      <Button
        v-if="showLaunch"
        type="button"
        variant="secondary"
        size="unset"
        class="chooser-tile-launch h-8 rounded-lg px-3 text-[13px]/5"
        @click.stop="launch"
        @keydown.enter.stop
        @keydown.space.stop
      >
        {{ launchLabel }}
      </Button>
      <Button
        v-if="props.showMenu && !isUpdating"
        variant="muted-textonly"
        size="unset"
        type="button"
        class="chooser-tile-kebab size-8 rounded-lg hover:bg-secondary hover:text-foreground"
        :title="t('chooser.moreActions')"
        :aria-label="t('chooser.moreActions')"
        :data-testid="TID.dashboardTileKebab(inst.id)"
        @click.stop="emit('open-kebab-menu', $event, inst)"
        @contextmenu.stop="emit('open-kebab-menu', $event, inst)"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <Ellipsis :size="16" />
      </Button>
    </div>
  </div>
</template>
