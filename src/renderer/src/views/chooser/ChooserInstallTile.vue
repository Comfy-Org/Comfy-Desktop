<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import { usePointMenu } from '@comfyorg/design-system/lib/menu/usePointMenu'
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Ellipsis, Info, LoaderCircle, OctagonAlert, Power, Server } from '@lucide/vue'
import { useSessionStore } from '../../stores/sessionStore'
import { launchFailed, useBuildProgress } from '../../composables/useBuildProgress'
import { isPromotingToWorkspace } from '../../composables/useInstallContextMenu'
import { useProgressStore } from '../../stores/progressStore'
import {
  buildDeviceKind,
  HOME_BUILD_TONES,
  isBuildUpdating,
  isCloudBuild,
  type HomeBuildTone
} from '../../panel/home/homeBuild'
import Tooltip from '../../components/ui/Tooltip.vue'
import BuildDeviceArt from '../../panel/home/BuildDeviceArt.vue'
import BuildMenu, { type BuildMenuAnchor } from '../../panel/home/BuildMenu.vue'
import BuildProgressBar from '../../panel/home/BuildProgressBar.vue'
import TruncatedText from '../../components/TruncatedText.vue'
import { TID } from '../../../../shared/testIds'
import { isBuildInstall } from '../../devplatform/buildState'
import type { Installation } from '../../types/ipc'

interface Props {
  installation: Installation
  showWhyCloud?: boolean
  lifecycleStatus?: 'idle' | 'launching' | 'running' | 'stopping' | 'error'
  showMenu?: boolean
  showFreeRunsPill?: boolean
  tone?: HomeBuildTone
  autoStart?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  lifecycleStatus: undefined,
  showMenu: true,
  tone: 'ember'
})

const emit = defineEmits<{
  pick: [installation: Installation]
  'open-details': [installation: Installation]
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
const isBusy = computed(() => install.progress.value !== null)
const isUninstalling = computed(() => install.progress.value?.kind === 'uninstall')
const isPromoting = computed(() => isPromotingToWorkspace(inst.value))
const progressLabel = computed(() => {
  const current = install.progress.value
  if (!current) return ''
  if (current.cancelling) return t('installProgress.cancelling')
  if (current.kind === 'uninstall') {
    return current.percent === null
      ? t('uninstallProgress.status')
      : t('uninstallProgress.tileStatus', { percent: current.percent })
  }
  const phase = t(current.kind === 'launch' ? 'home.buildStartingComfyUI' : 'home.buildInstalling')
  return current.percent == null
    ? phase
    : t('installProgress.detail', { phase, percent: current.percent })
})
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
const isUpdating = computed(() =>
  isBuildUpdating(inst.value, sessionStore.operationInstances.get(inst.value.id)?.actionId)
)
const hasError = computed(() =>
  props.lifecycleStatus == null
    ? sessionStore.errorInstances.has(inst.value.id)
    : props.lifecycleStatus === 'error'
)

const canActivate = computed(
  () => !isUninstalling.value && !isUpdating.value && !isStopping.value && !isPromoting.value
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
  if (isPromoting.value)
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

const startsWithDesktop = computed(() => props.autoStart && !isCloudBuild(inst.value))
const restingLabel = computed(() =>
  startsWithDesktop.value ? t('home.autoStartOn') : t('home.buildReady')
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

const updateNote = computed(() =>
  !isUninstalling.value && inst.value.statusTag?.style === 'update' && !isUpdating.value
    ? t('chooser.updatePill')
    : ''
)

const metaLine = computed(() => [leadingFact.value, trailingFact.value].filter(Boolean).join(' · '))

const opensLogs = computed(
  () => isBusy.value || (!dangerTag.value && launchFailed(progressStore, inst.value.id))
)
const opensExisting = computed(
  () =>
    isRunning.value ||
    isLaunching.value ||
    hasError.value ||
    dangerTag.value ||
    inst.value.sourceCategory === 'cloud' ||
    inst.value.sourceCategory === 'remote'
)
const openHint = computed(() => {
  if (opensLogs.value) return t('home.buildClickToViewLogs')
  return t(opensExisting.value ? 'home.buildClickToOpen' : 'home.buildClickToStart')
})
const openLabel = computed(() => {
  if (opensLogs.value) return t('installProgress.viewLogs')
  return t(opensExisting.value ? 'chooser.openInstall' : 'chooser.startInstall')
})

const tileEl = useTemplateRef<HTMLElement>('tile')
const nameClipped = ref(false)

function measureName(): void {
  const label = tileEl.value?.querySelector<HTMLElement>('.chooser-tile-name .truncated-text')
  nameClipped.value = !!label && label.scrollWidth > label.clientWidth
}

const tileHint = computed(() =>
  nameClipped.value ? [inst.value.name, openHint.value].filter(Boolean).join(' · ') : openHint.value
)

const canOpenMenu = computed(() => props.showMenu && !isUpdating.value)

function open(): void {
  if (!canActivate.value) return
  if (opensLogs.value) install.viewLogs()
  else if (dangerTag.value) emit('open-details', inst.value)
  else emit('pick', inst.value)
}

const openButton = useTemplateRef<HTMLButtonElement>('openButton')
const { open: menuOpen, menuProps, show: showMenuAtPointer, toggle: toggleMenu } = usePointMenu()
watch(canOpenMenu, (enabled) => {
  if (!enabled) menuOpen.value = false
})
const moreButton = shallowRef<HTMLElement | null>(null)
const menuReturnFocus = shallowRef<HTMLElement | null>(null)
const menuAnchor = computed<BuildMenuAnchor | undefined>(() => {
  const button = moreButton.value
  if (!button) return menuProps.value.reference
  return { getBoundingClientRect: () => button.getBoundingClientRect() }
})

function openMoreMenu(event: MouseEvent): void {
  if (!canOpenMenu.value) return
  const button = event.currentTarget as HTMLElement
  moreButton.value = button
  menuReturnFocus.value = button
  toggleMenu(event)
}

function openContextMenu(event: MouseEvent): void {
  if (!canOpenMenu.value) return
  moreButton.value = null
  menuReturnFocus.value = openButton.value
  showMenuAtPointer(event)
}
</script>

<template>
  <div
    ref="tile"
    class="chooser-tile chooser-tile--install group/tile relative flex h-25 min-w-0 items-center gap-[18px] overflow-hidden rounded-2xl border bg-[rgb(137_137_137/0.05)] px-[18px] transition-colors select-none"
    :class="[statusClasses, canActivate && 'cursor-pointer hover:bg-[rgb(137_137_137/0.09)]']"
    :style="{ borderColor: `rgb(${toneStyle.border} / 0.1)` }"
    :data-testid="TID.dashboardTile(inst.id)"
    :data-source-category="inst.sourceCategory"
    @click="open"
    @contextmenu.prevent="openContextMenu"
    @pointerenter="measureName"
  >
    <Tooltip
      v-if="canActivate"
      class="absolute inset-0 flex"
      :text="tileHint"
      side="top"
      :delay-ms="500"
      :should-open="() => !menuOpen"
    >
      <button
        ref="openButton"
        type="button"
        class="absolute inset-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        :aria-label="`${inst.name}, ${openLabel}`"
        data-testid="chooser-tile-open"
        @focus="measureName"
      />
    </Tooltip>
    <span
      class="pointer-events-none absolute inset-0 origin-[8%_0%] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      :class="
        canActivate &&
        !isBusy &&
        'group-hover/tile:scale-[2.6] group-has-[:focus-visible]/tile:scale-[2.6]'
      "
      :style="{
        background: `radial-gradient(60% 130% at 8% 0%, rgb(${toneStyle.tint} / 0.3), rgb(${toneStyle.tint} / 0) 70%)`
      }"
      aria-hidden="true"
    />
    <span
      v-if="inst.sourceCategory === 'remote'"
      class="chooser-tile-icon pointer-events-none relative flex size-16 shrink-0 items-center justify-center"
    >
      <Server :size="22" class="text-muted-foreground" aria-hidden="true" />
    </span>
    <BuildDeviceArt
      v-else
      class="chooser-tile-icon pointer-events-none relative shrink-0"
      :kind="buildDeviceKind(inst)"
      :glow="toneStyle.glow"
    />

    <div
      class="chooser-tile-body pointer-events-none relative flex min-w-0 flex-1 flex-col"
      :class="
        canOpenMenu && [
          'group-hover/tile:pr-10',
          'group-focus-within/tile:pr-10',
          menuOpen && 'pr-10'
        ]
      "
    >
      <div class="flex h-4 min-w-0 items-center gap-1.5 text-xs/4 text-muted-foreground">
        <span
          v-if="isBusy"
          class="chooser-tile-status flex min-w-0 items-center gap-1.5"
          :data-testid="`chooser-tile-progress-${inst.id}`"
        >
          <LoaderCircle
            :size="12"
            class="shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span class="truncate">{{ progressLabel }}</span>
        </span>
        <Button
          v-else-if="hasError && canActivate"
          variant="destructive-textonly"
          size="unset"
          type="button"
          class="chooser-tile-error-badge pointer-events-auto h-4 gap-1 text-xs/4 font-medium"
          :title="t('chooser.viewErrorTooltip')"
          @click.stop="viewError"
        >
          <OctagonAlert :size="12" />
          {{ t('chooser.statusError') }}
        </Button>
        <Button
          v-else-if="dangerTag && canActivate"
          variant="destructive-textonly"
          size="unset"
          type="button"
          class="chooser-tile-danger-tag pointer-events-auto h-4 min-w-0 gap-1 text-xs/4 font-medium"
          :title="t('chooser.viewErrorTooltip')"
          @click.stop="emit('view-danger', inst)"
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
        <span v-else class="flex min-w-0 items-center gap-1.5">
          <Power
            v-if="startsWithDesktop"
            :size="12"
            class="shrink-0"
            aria-hidden="true"
            :data-testid="`chooser-tile-starts-with-desktop-${inst.id}`"
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
            class="chooser-tile-why-cloud pointer-events-auto flex-none"
            :aria-label="t('firstUse.whyTryCloud')"
            :data-testid="TID.dashboardTileWhyCloud(inst.id)"
            @click.stop="emit('why-cloud')"
          >
            <Info :size="13" />
          </Button>
        </Tooltip>
      </div>
      <div
        v-if="metaLine || updateNote"
        class="chooser-tile-meta-line mt-0.5 flex min-w-0 text-xs/[17px] text-subtle-foreground"
      >
        <span v-if="metaLine" class="min-w-0 truncate">{{ metaLine }}</span>
        <span v-if="updateNote" class="shrink-0 whitespace-pre" data-testid="build-update-note"
          >{{ metaLine ? ' · ' : '' }}{{ updateNote }}</span
        >
      </div>
    </div>

    <Button
      v-if="canOpenMenu"
      type="button"
      variant="muted-textonly"
      size="unset"
      class="chooser-tile-kebab absolute top-1/2 right-2.5 size-8 -translate-y-1/2 rounded-lg p-0 opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 hover:bg-secondary hover:text-foreground focus-visible:opacity-100 motion-reduce:transition-none"
      :class="menuOpen && 'opacity-100'"
      :title="t('chooser.moreActions')"
      :aria-label="t('chooser.moreActions')"
      :data-testid="TID.dashboardTileKebab(inst.id)"
      @click.stop="openMoreMenu"
      @contextmenu.stop.prevent="openMoreMenu"
    >
      <Ellipsis :size="15" aria-hidden="true" />
    </Button>
    <BuildProgressBar
      v-if="install.progress.value?.percent != null"
      :percent="install.progress.value.percent"
      :label="progressLabel"
      :data-testid="`chooser-tile-progress-bar-${inst.id}`"
    />
    <BuildMenu
      v-if="canOpenMenu && menuAnchor"
      v-model:open="menuOpen"
      :build="inst"
      :anchor="menuAnchor"
      :align="moreButton ? 'end' : 'start'"
      :return-focus="menuReturnFocus"
    />
  </div>
</template>
