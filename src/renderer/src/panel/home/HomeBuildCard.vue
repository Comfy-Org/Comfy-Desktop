<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Ellipsis, LoaderCircle, OctagonAlert } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import BuildDeviceArt from './BuildDeviceArt.vue'
import BuildMenu, { type BuildMenuAnchor } from './BuildMenu.vue'
import BuildProgressBar from './BuildProgressBar.vue'
import {
  HOME_BUILD_TONES,
  homeBuildDetail,
  buildDeviceKind,
  isComfyCloud,
  type HomeBuildStatus,
  type HomeBuildTone
} from './homeBuild'
import { launchFailed, useBuildProgress } from '../../composables/useBuildProgress'
import { useProgressStore } from '../../stores/progressStore'
import type { Installation } from '../../types/ipc'

const { build, status, tone } = defineProps<{
  build: Installation
  status: HomeBuildStatus
  tone: HomeBuildTone
}>()

const emit = defineEmits<{ open: [] }>()

const { t } = useI18n()
const install = useBuildProgress(() => build)
const progressStore = useProgressStore()
const busy = computed(() => install.progress.value !== null)
const starting = computed(() => install.progress.value?.kind === 'launch')
const uninstalling = computed(() => install.progress.value?.kind === 'uninstall')
const busyTestId = computed(() => {
  if (uninstalling.value) return 'home-build-uninstalling'
  return starting.value ? 'home-build-starting' : 'home-build-installing'
})
const broken = computed(() => {
  if (build.statusTag?.style === 'danger') return build.statusTag.label
  return launchFailed(progressStore, build.id) ? t('home.buildDidntStart') : undefined
})

const toneStyle = computed(() => HOME_BUILD_TONES[tone])
const statusLabel = computed(() => {
  if (install.progress.value?.cancelling) return t('installProgress.cancelling')
  if (uninstalling.value) return t('uninstallProgress.status')
  if (busy.value) {
    const phase = t(starting.value ? 'home.buildStartingComfyUI' : 'home.buildInstalling')
    const percent = install.progress.value?.percent
    return percent == null ? phase : t('installProgress.detail', { phase, percent })
  }
  if (broken.value) return broken.value
  switch (status) {
    case 'running':
      return t('home.buildRunning')
    case 'starting':
      return t('home.buildStarting')
    case 'update':
      return build.statusTag?.label || t('chooser.updatePill')
    case 'always-on':
      return t('home.buildAlwaysOn')
    case 'ready':
      return t('home.buildReady')
    default:
      return status satisfies never
  }
})
const detail = computed(() =>
  isComfyCloud(build) ? t('home.cloudHardware') : homeBuildDetail(build)
)
const isLive = computed(() => !busy.value && (status === 'running' || status === 'always-on'))
const subtitle = computed(() => (uninstalling.value ? install.detail.value : detail.value))
const testId = computed(() => (busy.value ? busyTestId.value : 'home-build'))

function onClick(): void {
  if (!busy.value) emit('open')
  else if (!uninstalling.value) install.viewLogs()
}

const menuOpen = ref(false)
const menuAt = shallowRef<{ anchor: BuildMenuAnchor; align: 'start' | 'end' } | null>(null)

function showMenu(anchor: BuildMenuAnchor, align: 'start' | 'end'): void {
  menuAt.value = { anchor, align }
  menuOpen.value = true
}

function openMoreMenu(event: MouseEvent): void {
  const button = event.currentTarget as HTMLElement
  showMenu({ getBoundingClientRect: () => button.getBoundingClientRect() }, 'end')
}

function openContextMenu(event: MouseEvent): void {
  const { clientX: x, clientY: y } = event
  showMenu({ getBoundingClientRect: () => new DOMRect(x, y, 0, 0) }, 'start')
}
</script>

<template>
  <div
    class="group relative flex h-25 w-full items-center gap-[18px] overflow-hidden rounded-2xl border bg-[rgb(137_137_137/0.05)] px-[18px] text-left transition-colors"
    :class="!uninstalling && 'cursor-pointer hover:bg-[rgb(137_137_137/0.09)]'"
    :style="{ borderColor: `rgb(${toneStyle.border} / 0.1)` }"
    :data-testid="testId"
    :data-build-id="build.id"
    @click="onClick"
    @contextmenu.prevent="openContextMenu"
  >
    <button
      v-if="!uninstalling"
      type="button"
      class="absolute inset-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      :aria-label="`${build.name}, ${statusLabel}`"
      data-testid="home-build-open"
    />
    <span
      class="pointer-events-none absolute inset-0 origin-[8%_0%] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      :class="!busy && 'group-hover:scale-[2.6] group-has-[:focus-visible]:scale-[2.6]'"
      :style="{
        background: `radial-gradient(60% 130% at 8% 0%, rgb(${toneStyle.tint} / 0.3), rgb(${toneStyle.tint} / 0) 70%)`
      }"
      data-testid="home-build-glow"
      aria-hidden="true"
    />
    <BuildDeviceArt
      class="pointer-events-none relative shrink-0"
      :kind="buildDeviceKind(build)"
      :glow="toneStyle.glow"
    />
    <span
      class="pointer-events-none relative flex min-w-0 flex-1 flex-col group-hover:pr-10 group-has-[:focus-visible]:pr-10"
      :class="menuOpen && 'pr-10'"
    >
      <span
        class="flex h-4 items-center gap-1.5 text-xs/4"
        :class="!busy && broken ? 'text-destructive' : 'text-muted-foreground'"
        data-testid="home-build-status"
      >
        <LoaderCircle
          v-if="busy"
          :size="12"
          class="shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
          aria-hidden="true"
        />
        <OctagonAlert v-else-if="broken" :size="12" class="shrink-0" aria-hidden="true" />
        <span
          v-else-if="isLive"
          class="size-1.5 shrink-0 rounded-full bg-[#59d38c] shadow-[0_0_0_3px_rgb(89_211_140/0.36)]"
          aria-hidden="true"
        />
        <Check v-else-if="status === 'ready'" :size="12" aria-hidden="true" />
        <span class="truncate">{{ statusLabel }}</span>
      </span>
      <span
        class="mt-1 truncate text-[15px]/[21px] font-semibold text-foreground"
        data-testid="home-build-name"
      >
        {{ build.name }}
      </span>
      <span
        class="mt-0.5 truncate text-xs/[17px] text-subtle-foreground"
        :data-testid="uninstalling ? 'home-build-install-detail' : 'home-build-detail'"
      >
        {{ subtitle }}
      </span>
    </span>
    <Button
      type="button"
      variant="muted-textonly"
      size="unset"
      class="absolute top-1/2 right-2.5 size-8 -translate-y-1/2 rounded-lg p-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-secondary hover:text-foreground focus-visible:opacity-100 motion-reduce:transition-none"
      :class="menuOpen && 'opacity-100'"
      :aria-label="t('chooser.moreActions')"
      :title="t('chooser.moreActions')"
      data-testid="home-build-more"
      @click.stop="openMoreMenu"
      @contextmenu.stop.prevent="openMoreMenu"
    >
      <Ellipsis :size="15" aria-hidden="true" />
    </Button>
    <BuildProgressBar
      v-if="install.progress.value?.percent != null"
      :percent="install.progress.value.percent"
      :label="statusLabel"
      data-testid="home-build-progress"
    />
    <BuildMenu
      v-if="menuAt"
      v-model:open="menuOpen"
      :build="build"
      :anchor="menuAt.anchor"
      :align="menuAt.align"
    />
  </div>
</template>
