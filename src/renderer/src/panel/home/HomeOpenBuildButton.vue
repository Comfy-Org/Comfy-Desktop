<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Cloud, Laptop, LoaderCircle } from '@lucide/vue'
import SplitButton from '../../components/ui/SplitButton.vue'
import OpenBuildMenuItems from './OpenBuildMenuItems.vue'
import { isCloudBuild, type HomeBuildStatus } from './homeBuild'
import type { Installation } from '../../types/ipc'

const { builds, target, statusOf } = defineProps<{
  builds: readonly Installation[]
  target: Installation
  statusOf: (build: Installation) => HomeBuildStatus
}>()

const emit = defineEmits<{
  open: [build: Installation]
  pick: [build: Installation]
}>()

const { t } = useI18n()

const open = ref(false)

const targetStarting = computed(() => statusOf(target) === 'starting')

function onWindowBlur(): void {
  open.value = false
}
onMounted(() => window.addEventListener('blur', onWindowBlur))
onBeforeUnmount(() => window.removeEventListener('blur', onWindowBlur))
</script>

<template>
  <SplitButton
    v-model:open="open"
    :label="t('home.openComfyUIIn', { name: target.name })"
    :tooltip="targetStarting ? t('home.opensWhenReady') : t('home.opensIn', { name: target.name })"
    :description="targetStarting ? t('home.opensWhenReady') : undefined"
    :menu-label="t('home.chooseBuildToOpen')"
    main-testid="home-open-comfyui"
    menu-testid="home-open-build-menu"
    data-testid="home-open-build"
    @run="emit('open', target)"
  >
    <LoaderCircle
      v-if="targetStarting"
      class="shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
      :size="14"
      aria-hidden="true"
      data-testid="home-open-comfyui-spinner"
    />
    <component
      :is="isCloudBuild(target) ? Cloud : Laptop"
      v-else
      class="shrink-0"
      :size="14"
      :data-kind="isCloudBuild(target) ? 'cloud' : 'local'"
      aria-hidden="true"
      data-testid="home-open-comfyui-icon"
    />
    <span>{{ t('home.openComfyUI') }}</span>
    <span class="sr-only" data-testid="home-open-comfyui-build">{{ target.name }}</span>
    <template v-if="builds.length > 1" #menu>
      <OpenBuildMenuItems
        :builds="builds"
        :target="target"
        :status-of="statusOf"
        @pick="emit('pick', $event)"
      />
    </template>
  </SplitButton>
</template>
