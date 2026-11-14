<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, LoaderCircle, OctagonAlert } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import BuildDeviceArt from './BuildDeviceArt.vue'
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
const installing = computed(() => install.progress.value !== null)
const starting = computed(() => install.progress.value?.kind === 'launch')
const broken = computed(() => {
  if (build.statusTag?.style === 'danger') return build.statusTag.label
  return launchFailed(progressStore, build.id) ? t('home.buildDidntStart') : undefined
})

const toneStyle = computed(() => HOME_BUILD_TONES[tone])
const statusLabel = computed(() => {
  if (installing.value)
    return t(starting.value ? 'home.buildStartingComfyUI' : 'home.buildInstalling')
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
const detail = computed(() => {
  if (installing.value) return install.detail.value
  return isComfyCloud(build) ? t('home.cloudHardware') : homeBuildDetail(build)
})
const isLive = computed(() => !installing.value && (status === 'running' || status === 'always-on'))
const CARD_CLASS =
  'group relative flex h-25 w-full items-center gap-[18px] overflow-hidden rounded-2xl border bg-[rgb(137_137_137/0.05)] px-[18px] text-left outline-none transition-colors'
</script>

<template>
  <div
    v-if="installing"
    :class="CARD_CLASS"
    :style="{ borderColor: `rgb(${toneStyle.border} / 0.1)` }"
    :data-testid="starting ? 'home-build-starting' : 'home-build-installing'"
    :data-build-id="build.id"
  >
    <span
      class="pointer-events-none absolute inset-0"
      :style="{
        background: `radial-gradient(60% 130% at 8% 0%, rgb(${toneStyle.tint} / 0.3), rgb(${toneStyle.tint} / 0) 70%)`
      }"
      aria-hidden="true"
    />
    <BuildDeviceArt
      class="relative shrink-0"
      :kind="buildDeviceKind(build)"
      :glow="toneStyle.glow"
    />
    <span class="relative flex min-w-0 flex-1 flex-col">
      <span class="flex h-4 items-center gap-1.5 text-xs/4 text-muted-foreground">
        <LoaderCircle
          :size="12"
          class="shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
          aria-hidden="true"
        />
        <span class="truncate">{{ statusLabel }}</span>
      </span>
      <span class="mt-1 truncate text-[15px]/[21px] font-semibold text-foreground">
        {{ build.name }}
      </span>
      <span
        class="mt-0.5 truncate text-xs/[17px] text-subtle-foreground"
        data-testid="home-build-install-detail"
      >
        {{ detail }}
      </span>
    </span>
    <span class="relative flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="muted-textonly"
        size="unset"
        class="h-8 rounded-lg px-3 text-[13px]/5 font-normal hover:bg-secondary hover:text-foreground"
        data-testid="home-build-view-logs"
        @click="install.viewLogs"
      >
        {{ t('installProgress.viewLogs') }}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="unset"
        class="h-8 rounded-lg px-3 text-[13px]/5 font-normal"
        :disabled="install.progress.value?.cancelling"
        data-testid="home-build-cancel"
        @click="install.cancel"
      >
        {{ t('common.cancel') }}
      </Button>
    </span>
    <span
      v-if="install.progress.value?.percent != null"
      class="absolute bottom-0 left-0 h-[3px] rounded-r-full bg-foreground transition-[width] duration-500 ease-out motion-reduce:transition-none"
      :style="{ width: `${install.progress.value?.percent ?? 0}%` }"
      role="progressbar"
      :aria-label="statusLabel"
      :aria-valuenow="install.progress.value?.percent ?? 0"
      aria-valuemin="0"
      aria-valuemax="100"
      data-testid="home-build-progress"
    />
  </div>
  <button
    v-else
    type="button"
    :class="[
      CARD_CLASS,
      'cursor-pointer hover:bg-[rgb(137_137_137/0.09)] focus-visible:ring-2 focus-visible:ring-ring'
    ]"
    :style="{ borderColor: `rgb(${toneStyle.border} / 0.1)` }"
    data-testid="home-build"
    :data-build-id="build.id"
    @click="emit('open')"
  >
    <span
      class="pointer-events-none absolute inset-0 origin-[8%_0%] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[2.6] group-focus-visible:scale-[2.6] motion-reduce:transition-none"
      :style="{
        background: `radial-gradient(60% 130% at 8% 0%, rgb(${toneStyle.tint} / 0.3), rgb(${toneStyle.tint} / 0) 70%)`
      }"
      data-testid="home-build-glow"
      aria-hidden="true"
    />
    <BuildDeviceArt
      class="relative shrink-0"
      :kind="buildDeviceKind(build)"
      :glow="toneStyle.glow"
    />
    <span class="relative flex min-w-0 flex-col">
      <span
        class="flex h-4 items-center gap-1.5 text-xs/4"
        :class="broken ? 'text-destructive' : 'text-muted-foreground'"
        data-testid="home-build-status"
      >
        <OctagonAlert v-if="broken" :size="12" class="shrink-0" aria-hidden="true" />
        <span
          v-else-if="isLive"
          class="size-1.5 shrink-0 rounded-full bg-[#59d38c] shadow-[0_0_0_3px_rgb(89_211_140/0.36)]"
          aria-hidden="true"
        />
        <Check v-else-if="status === 'ready'" :size="12" aria-hidden="true" />
        <span class="truncate">{{ statusLabel }}</span>
      </span>
      <span class="mt-1 truncate text-[15px]/[21px] font-semibold text-foreground">
        {{ build.name }}
      </span>
      <span class="mt-0.5 truncate text-xs/[17px] text-subtle-foreground">
        {{ detail }}
      </span>
    </span>
  </button>
</template>
