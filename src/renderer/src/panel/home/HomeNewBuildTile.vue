<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Plus } from '@lucide/vue'
import BuildDeviceArt from './BuildDeviceArt.vue'
import { deviceKindForPlatform } from './homeBuild'

const emit = defineEmits<{ open: [] }>()

const { t } = useI18n()
const deviceKind = deviceKindForPlatform(window.api?.platform)
</script>

<template>
  <button
    type="button"
    class="group relative flex h-25 w-full cursor-pointer items-center gap-[18px] overflow-hidden rounded-2xl border border-[rgb(200_200_200/0.1)] bg-[rgb(137_137_137/0.05)] px-[18px] text-left outline-none transition-colors hover:bg-[rgb(137_137_137/0.09)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    data-testid="home-new-build"
    @click="emit('open')"
  >
    <BuildDeviceArt
      class="pointer-events-none relative shrink-0 opacity-45 grayscale transition-opacity duration-200 group-hover:opacity-70 group-focus-visible:opacity-70 motion-reduce:transition-none"
      :kind="deviceKind"
      glow="#8A8A8A"
    />
    <span class="pointer-events-none relative flex min-w-0 flex-1 flex-col">
      <span class="flex h-4 items-center gap-1.5 text-xs/4 text-muted-foreground">
        <Plus :size="12" class="shrink-0" aria-hidden="true" />
        <span class="truncate">{{ t('home.newBuildStatus') }}</span>
      </span>
      <span
        class="mt-1 truncate text-[15px]/[21px] font-semibold text-foreground"
        data-testid="home-new-build-name"
      >
        {{ t('sidebar.newBuild') }}
      </span>
      <span class="mt-0.5 truncate text-xs/[17px] text-subtle-foreground">
        {{ t('home.newBuildDetail') }}
      </span>
    </span>
  </button>
</template>
