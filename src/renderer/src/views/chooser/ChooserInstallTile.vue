<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowRightLeft,
  ArrowUpCircle,
  Ellipsis,
  ExternalLink,
  Info,
  LoaderCircle,
  OctagonAlert,
  Play
} from 'lucide-vue-next'
import { useSessionStore } from '../../stores/sessionStore'
import { progressOpKindForActionId } from '../../lib/progressOpKind'
import { installTypeMetaForInstall } from '../../lib/installTypeIcon'
import StatusChip from '../../components/ui/StatusChip.vue'
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

const whereLabel = computed(() => {
  if (inst.value.sourceCategory === 'cloud') return t('chooser.filterCloud')
  if (inst.value.sourceCategory === 'remote') return t('chooser.filterRemote')
  return t('chooser.filterThisComputer')
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

const launchLabel = computed(() =>
  opensExisting.value ? t('chooser.openInstall') : t('chooser.startInstall')
)

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
    class="chooser-tile chooser-tile--install group/tile relative grid min-w-0 cursor-pointer grid-rows-[auto_auto_1fr] gap-2.5 rounded-card bg-card/72 p-4 outline-none transition-[background-color,box-shadow] duration-160 select-none hover:bg-card-hover/80 focus-visible:shadow-[0_0_0_2px_var(--color-ring)]"
    :class="statusClasses"
    :data-testid="TID.dashboardTile(inst.id)"
    :data-source-category="inst.sourceCategory"
    @click="openDetails"
    @keydown.enter="openDetails"
    @keydown.space.prevent="openDetails"
    @contextmenu.prevent="handleContextMenu"
  >
    <span
      class="chooser-tile-icon flex h-5 min-w-0 items-center gap-1.5 pr-8 text-xs text-muted-foreground"
      :title="t(typeMeta.labelKey)"
    >
      <component :is="typeMeta.icon" :size="15" class="shrink-0" aria-hidden="true" />
      <span class="truncate">{{ whereLabel }}</span>
    </span>

    <div class="chooser-tile-actions absolute top-3 right-3 z-1 flex items-center gap-1">
      <span
        v-if="props.showFreeRunsPill && !hasError && !statusPill && !dangerTag"
        class="chooser-cloud-runs-pill inline-flex shrink-0 items-center rounded-full bg-foreground px-2 py-[3px] text-[10px] [line-height:normal] font-bold tracking-[0.02em] whitespace-nowrap text-background uppercase"
        data-testid="chooser-cloud-runs-pill"
        >{{ $t('firstUse.cloudFreeRunsPill') }}</span
      >
      <Button
        v-if="props.showMenu && !isUpdating"
        variant="muted-textonly"
        size="unset"
        type="button"
        class="chooser-tile-kebab size-6 rounded-md opacity-0 group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 hover:bg-secondary hover:text-foreground"
        :title="t('chooser.moreActions')"
        :aria-label="t('chooser.moreActions')"
        :data-testid="TID.dashboardTileKebab(inst.id)"
        @click.stop="emit('open-kebab-menu', $event, inst)"
        @contextmenu.stop="emit('open-kebab-menu', $event, inst)"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <Ellipsis :size="15" />
      </Button>
    </div>

    <div class="chooser-tile-body flex min-w-0 flex-col gap-1">
      <div
        class="chooser-tile-name-row flex min-w-0 items-center gap-1.5 [&_.tooltip-wrap]:flex-none"
      >
        <TruncatedText
          class="chooser-tile-name mt-0 block max-w-full min-w-0 text-[14px] font-semibold text-foreground [&.tooltip-wrap]:block"
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
      <TruncatedText
        v-if="metaLine"
        class="chooser-tile-meta-line max-w-full min-w-0 text-xs text-subtle-foreground [&.tooltip-wrap]:block"
        :text="metaLine"
      />
    </div>

    <div class="chooser-tile-footer mt-1.5 flex min-w-0 items-end justify-between gap-3 self-end">
      <div class="flex h-7 min-w-0 items-center gap-2">
        <Button
          v-if="hasError"
          variant="destructive-textonly"
          size="unset"
          type="button"
          class="chooser-tile-error-badge h-5 gap-[5px] rounded-full bg-destructive/16 px-2 text-[11px] leading-none font-medium hover:bg-destructive/25"
          :title="t('chooser.viewErrorTooltip')"
          @click.stop="emit('view-error', inst)"
          @keydown.enter.stop
          @keydown.space.stop
        >
          <OctagonAlert :size="11" />
          {{ t('chooser.statusError') }}
        </Button>
        <StatusChip
          v-else-if="statusPill"
          class="chooser-tile-status pointer-events-none"
          :class="statusPill.markerClass"
          :tone="statusPill.tone"
        >
          <template v-if="statusPill.spinning" #icon>
            <LoaderCircle
              :size="11"
              class="chooser-tile-status-spinner shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
              aria-hidden="true"
            />
          </template>
          {{ t(statusPill.label) }}
        </StatusChip>
        <Button
          v-else-if="dangerTag"
          variant="destructive-textonly"
          size="unset"
          type="button"
          class="chooser-tile-danger-tag h-5 min-w-0 gap-[5px] rounded-full bg-destructive/16 px-2 text-[11px] leading-none font-medium hover:bg-destructive/25"
          :title="t('chooser.viewErrorTooltip')"
          @click.stop="emit('view-danger', inst)"
          @keydown.enter.stop
          @keydown.space.stop
        >
          <OctagonAlert :size="11" />
          <span class="truncate">{{ dangerTag.label }}</span>
        </Button>
        <StatusChip v-else-if="hasUpdate" tone="warn">
          <template #icon><ArrowUpCircle :size="11" aria-hidden="true" /></template>
          {{ t('chooser.updateAvailable') }}
        </StatusChip>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <Button
          v-if="showLaunch"
          type="button"
          :variant="actionPill ? 'muted-textonly' : 'secondary'"
          size="unset"
          class="chooser-tile-launch h-7 gap-1.5 rounded-lg text-[13px]/5"
          :class="actionPill ? 'w-7' : 'px-2.5'"
          :aria-label="launchLabel"
          :title="actionPill ? launchLabel : undefined"
          @click.stop="launch"
          @keydown.enter.stop
          @keydown.space.stop
        >
          <component :is="opensExisting ? ExternalLink : Play" :size="13" aria-hidden="true" />
          <template v-if="!actionPill">{{ launchLabel }}</template>
        </Button>
        <Tooltip v-if="actionPill" :text="actionPill.tooltip" class="chooser-tile-pill-action">
          <Button
            type="button"
            variant="secondary"
            size="unset"
            class="chooser-tile-pill h-7 shrink-0 gap-1.5 rounded-lg px-2.5 text-[13px]/5"
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
            <component :is="actionPill.icon" :size="13" />
            {{ actionPill.label }}
          </Button>
        </Tooltip>
      </div>
    </div>
  </div>
</template>
