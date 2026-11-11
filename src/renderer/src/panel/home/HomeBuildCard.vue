<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'
import BuildDeviceArt from './BuildDeviceArt.vue'
import {
  HOME_BUILD_TONES,
  homeBuildDetail,
  isCloudBuild,
  isComfyCloud,
  type HomeBuildStatus,
  type HomeBuildTone
} from './homeBuild'
import type { Installation } from '../../types/ipc'

const { build, status, tone } = defineProps<{
  build: Installation
  status: HomeBuildStatus
  tone: HomeBuildTone
}>()

const emit = defineEmits<{ open: [] }>()

const { t } = useI18n()

const toneStyle = computed(() => HOME_BUILD_TONES[tone])
const statusLabel = computed(() => {
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
const isLive = computed(() => status === 'running' || status === 'always-on')
</script>

<template>
  <button
    type="button"
    class="group relative flex h-25 w-full cursor-pointer items-center gap-[18px] overflow-hidden rounded-2xl border bg-[rgb(137_137_137/0.05)] px-[18px] text-left outline-none transition-colors hover:bg-[rgb(137_137_137/0.09)] focus-visible:ring-2 focus-visible:ring-ring"
    :style="{ borderColor: `rgb(${toneStyle.border} / 0.1)` }"
    data-testid="home-build"
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
      :kind="isCloudBuild(build) ? 'cloud' : 'laptop'"
      :glow="toneStyle.glow"
    />
    <span class="relative flex min-w-0 flex-col">
      <span class="flex h-4 items-center gap-1.5 text-xs/4 text-muted-foreground">
        <span
          v-if="isLive"
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
