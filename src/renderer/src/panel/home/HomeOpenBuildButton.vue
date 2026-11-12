<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DropdownMenuRadioGroup } from 'reka-ui'
import { ArrowRight, Cloud, Laptop } from 'lucide-vue-next'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import SplitButton from '../../components/ui/SplitButton.vue'
import { isCloudBuild, type HomeBuildStatus } from './homeBuild'
import type { Installation } from '../../types/ipc'

const { builds, target, statusOf } = defineProps<{
  builds: readonly Installation[]
  target: Installation
  statusOf: (build: Installation) => HomeBuildStatus
}>()

const emit = defineEmits<{
  open: [build: Installation]
  select: [build: Installation]
}>()

const { t } = useI18n()

const open = ref(false)

function statusLabel(build: Installation): string {
  switch (statusOf(build)) {
    case 'running':
      return t('home.buildRunning')
    case 'starting':
      return t('home.buildStarting')
    case 'always-on':
      return t('home.buildAlwaysOn')
    default:
      return t('home.buildReady')
  }
}

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
    :tooltip="t('home.openComfyUIIn', { name: target.name })"
    :menu-label="t('home.chooseBuildToOpen')"
    main-testid="home-open-comfyui"
    menu-testid="home-open-build-menu"
    data-testid="home-open-build"
    @run="emit('open', target)"
  >
    <component
      :is="isCloudBuild(target) ? Cloud : Laptop"
      v-if="builds.length > 1"
      class="shrink-0"
      :size="14"
      :data-kind="isCloudBuild(target) ? 'cloud' : 'local'"
      aria-hidden="true"
      data-testid="home-open-comfyui-icon"
    />
    <span>{{ t('home.openComfyUI') }}</span>
    <span class="sr-only" data-testid="home-open-comfyui-build">{{ target.name }}</span>
    <ArrowRight v-if="builds.length < 2" class="shrink-0" :size="14" aria-hidden="true" />
    <template v-if="builds.length > 1" #menu>
      <DropdownMenuRadioGroup :model-value="target.id">
        <MenuRadioItem
          v-for="build in builds"
          :key="build.id"
          as="button"
          type="button"
          :value="build.id"
          class="ui-select-option w-full data-[state=checked]:bg-muted data-[state=checked]:data-highlighted:bg-muted"
          data-testid="home-open-build-option"
          @select="emit('select', build)"
        >
          <component
            :is="isCloudBuild(build) ? Cloud : Laptop"
            class="shrink-0"
            :size="14"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 truncate text-left">{{ build.name }}</span>
          <span
            class="flex shrink-0 items-center gap-1.5 text-muted-foreground"
            data-testid="home-open-build-status"
            ><span
              class="size-1.5 shrink-0 rounded-full"
              :class="statusOf(build) === 'starting' ? 'bg-muted-foreground' : 'bg-[#59d38c]'"
              aria-hidden="true"
              data-testid="home-open-build-status-dot"
            />{{ statusLabel(build) }}</span
          >
        </MenuRadioItem>
      </DropdownMenuRadioGroup>
    </template>
  </SplitButton>
</template>
