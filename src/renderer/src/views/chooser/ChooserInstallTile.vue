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
  Play,
  Server,
  Check
} from 'lucide-vue-next'
import { useSessionStore } from '../../stores/sessionStore'
import { launchFailed, useBuildProgress } from '../../composables/useBuildProgress'
import { useProgressStore } from '../../stores/progressStore'
import { progressOpKindForActionId } from '../../lib/progressOpKind'
import {
  buildDeviceKind,
  HOME_BUILD_TONES,
  isCloudBuild,
  type HomeBuildTone
} from '../../panel/home/homeBuild'
import Tooltip from '../../components/ui/Tooltip.vue'
import BuildDeviceArt from '../../panel/home/BuildDeviceArt.vue'
import TruncatedText from '../../components/TruncatedText.vue'
import { TID } from '../../../../shared/testIds'
import { isBuildInstall } from '../../devplatform/buildState'
import type { Installation } from '../../types/ipc'

interface Props {
  installation: Installation
  showWhyCloud?: boolean
  lifecycleStatus?: 'idle' | 'launching' | 'running' | 'stopping' | 'error'
  isStoppedActionGated: boolean
  isPromotingToWorkspace?: boolean
  showMenu?: boolean
  showFreeRunsPill?: boolean
  tone?: HomeBuildTone
}

const props = withDefaults(defineProps<Props>(), {
  lifecycleStatus: undefined,
  showMenu: true,
  tone: 'ember'
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
const install = useBuildProgress(() => props.installation)
const progressStore = useProgressStore()

function viewError(): void {
  if (launchFailed(progressStore, inst.value.id)) install.viewLogs()
  else emit('view-error', inst.value)
}
const isInstalling = computed(() => install.progress.value !== null)
const toneStyle = computed(() => HOME_BUILD_TONES[props.tone])

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

const restingLabel = computed(() =>
  isCloudBuild(inst.value) ? t('home.buildAlwaysOn') : t('home.buildReady')
)

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

const showLaunch = computed(
  () =>
    !isInstalling.value && !isUpdating.value && !isStopping.value && !props.isPromotingToWorkspace
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
  if (isInstalling.value) {
    install.viewLogs()
    return
  }
  if (isStopping.value || isUpdating.value) return
  emit('open-details', inst.value)
}

function launch(): void {
  if (isStopping.value || isUpdating.value) return
  emit('pick', inst.value)
}

function handleContextMenu(event: MouseEvent): void {
  if (!props.showMenu || isUpdating.value || isInstalling.value) return
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
    class="chooser-tile chooser-tile--install group/tile relative flex h-25 min-w-0 cursor-pointer items-center gap-[18px] overflow-hidden rounded-2xl border bg-[rgb(137_137_137/0.05)] pr-3 pl-[18px] outline-none transition-[background-color,box-shadow] duration-160 select-none hover:bg-[rgb(137_137_137/0.09)] focus-visible:shadow-[0_0_0_2px_var(--color-ring)]"
    :class="statusClasses"
    :style="{ borderColor: `rgb(${toneStyle.border} / 0.1)` }"
    :data-testid="TID.dashboardTile(inst.id)"
    :data-source-category="inst.sourceCategory"
    @click="openDetails"
    @keydown.enter="openDetails"
    @keydown.space.prevent="openDetails"
    @contextmenu.prevent="handleContextMenu"
  >
    <span
      class="pointer-events-none absolute inset-0 origin-[8%_0%] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/tile:scale-[2.6] group-focus-visible/tile:scale-[2.6] motion-reduce:transition-none"
      :style="{
        background: `radial-gradient(60% 130% at 8% 0%, rgb(${toneStyle.tint} / 0.3), rgb(${toneStyle.tint} / 0) 70%)`
      }"
      aria-hidden="true"
    />
    <span
      v-if="inst.sourceCategory === 'remote'"
      class="chooser-tile-icon relative flex size-16 shrink-0 items-center justify-center"
    >
      <Server :size="22" class="text-muted-foreground" aria-hidden="true" />
    </span>
    <BuildDeviceArt
      v-else
      class="chooser-tile-icon relative shrink-0"
      :kind="buildDeviceKind(inst)"
      :glow="toneStyle.glow"
    />

    <div class="chooser-tile-body relative flex min-w-0 flex-1 flex-col">
      <div class="flex h-4 min-w-0 items-center gap-1.5 text-xs/4 text-muted-foreground">
        <span
          v-if="isInstalling"
          class="chooser-tile-status flex min-w-0 items-center gap-1.5"
          :data-testid="`chooser-tile-progress-${inst.id}`"
        >
          <LoaderCircle
            :size="12"
            class="shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span class="truncate">{{
            install.progress.value?.kind === 'launch'
              ? t('chooser.statusLaunching')
              : t('installProgress.tileStatus', { percent: install.progress.value?.percent ?? 0 })
          }}</span>
        </span>
        <Button
          v-else-if="hasError"
          variant="destructive-textonly"
          size="unset"
          type="button"
          class="chooser-tile-error-badge h-4 gap-1 text-xs/4 font-medium"
          :title="t('chooser.viewErrorTooltip')"
          @click.stop="viewError"
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
          class="chooser-tile-danger-tag h-4 min-w-0 gap-1 text-xs/4 font-medium"
          :title="t('chooser.viewErrorTooltip')"
          @click.stop="emit('view-danger', inst)"
          @keydown.enter.stop
          @keydown.space.stop
        >
          <OctagonAlert :size="12" />
          <span class="truncate">{{ dangerTag.label }}</span>
        </Button>
        <span
          v-else-if="statusPill"
          class="chooser-tile-status flex min-w-0 items-center gap-1.5"
          :class="statusPill.markerClass"
        >
          <LoaderCircle
            v-if="statusPill.spinning"
            :size="12"
            class="chooser-tile-status-spinner shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span
            v-else-if="statusPill.tone === 'go'"
            class="size-1.5 shrink-0 rounded-full bg-[#59d38c] shadow-[0_0_0_3px_rgb(89_211_140/0.36)]"
            aria-hidden="true"
          />
          <span class="truncate">{{ t(statusPill.label) }}</span>
        </span>
        <span v-else-if="hasUpdate" class="flex min-w-0 items-center gap-1.5">
          <ArrowUpCircle :size="12" class="shrink-0" aria-hidden="true" />
          <span class="truncate">{{ inst.statusTag?.label || t('chooser.updateAvailable') }}</span>
        </span>
        <span v-else class="flex min-w-0 items-center gap-1.5">
          <span
            v-if="isCloudBuild(inst)"
            class="size-1.5 shrink-0 rounded-full bg-[#59d38c] shadow-[0_0_0_3px_rgb(89_211_140/0.36)]"
            aria-hidden="true"
          />
          <Check v-else :size="12" class="shrink-0" aria-hidden="true" />
          <span class="truncate">{{ restingLabel }}</span>
        </span>
        <span
          v-if="props.showFreeRunsPill && !hasError && !statusPill && !dangerTag"
          class="chooser-cloud-runs-pill ml-1 inline-flex h-4 shrink-0 items-center rounded-[5px] bg-foreground/10 px-1.5 text-[11px] font-medium whitespace-nowrap text-foreground"
          data-testid="chooser-cloud-runs-pill"
          ><span class="block lowercase first-letter:uppercase">{{
            $t('firstUse.cloudFreeRunsPill')
          }}</span></span
        >
      </div>

      <div
        class="chooser-tile-name-row mt-1 flex min-w-0 items-center gap-1.5 [&_.tooltip-wrap]:flex-none"
      >
        <TruncatedText
          class="chooser-tile-name mt-0 block max-w-full min-w-0 text-[15px]/[21px] font-semibold text-foreground [&.tooltip-wrap]:block"
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
            <Info :size="13" />
          </Button>
        </Tooltip>
      </div>
      <TruncatedText
        v-if="metaLine"
        class="chooser-tile-meta-line mt-0.5 max-w-full min-w-0 text-xs/[17px] text-subtle-foreground [&.tooltip-wrap]:block"
        :text="metaLine"
      />
    </div>

    <div class="chooser-tile-footer relative flex shrink-0 items-center gap-1">
      <template v-if="isInstalling">
        <Button
          type="button"
          variant="muted-textonly"
          size="unset"
          class="h-8 rounded-lg px-3 text-[13px]/5 font-normal hover:bg-secondary hover:text-foreground"
          :data-testid="`chooser-tile-view-logs-${inst.id}`"
          @click.stop="install.viewLogs"
          @keydown.enter.stop
          @keydown.space.stop
        >
          {{ t('installProgress.viewLogs') }}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="unset"
          class="h-8 rounded-lg px-3 text-[13px]/5 font-normal"
          :disabled="install.progress.value?.cancelling"
          :data-testid="`chooser-tile-cancel-${inst.id}`"
          @click.stop="install.cancel"
          @keydown.enter.stop
          @keydown.space.stop
        >
          {{ t('common.cancel') }}
        </Button>
      </template>
      <Tooltip v-else-if="actionPill" :text="actionPill.tooltip" class="chooser-tile-pill-action">
        <Button
          type="button"
          variant="secondary"
          size="unset"
          class="chooser-tile-pill h-8 shrink-0 gap-1.5 rounded-lg px-3 text-[13px]/5"
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
      <Button
        v-if="showLaunch"
        type="button"
        variant="secondary"
        size="unset"
        class="chooser-tile-launch h-8 gap-1.5 rounded-lg px-3 text-[13px]/5"
        :aria-label="launchLabel"
        @click.stop="launch"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <component :is="opensExisting ? ExternalLink : Play" :size="13" aria-hidden="true" />
        {{ launchLabel }}
      </Button>
      <div class="chooser-tile-actions flex items-center">
        <Button
          v-if="props.showMenu && !isUpdating && !isInstalling"
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
          <Ellipsis :size="15" />
        </Button>
      </div>
    </div>
  </div>
</template>
