<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DropdownMenuRadioGroup } from 'reka-ui'
import { Cloud, Laptop } from 'lucide-vue-next'
import BaseMenuRadioItem from '../../components/ui/BaseMenuRadioItem.vue'
import SplitButton from '../../components/ui/SplitButton.vue'
import Tooltip from '../../components/ui/Tooltip.vue'
import { useSessionStore } from '../../stores/sessionStore'
import { isCloudBuild, type HomeBuildStatus } from './homeBuild'
import type { Installation } from '../../types/ipc'

const { builds, target, statusOf } = defineProps<{
  builds: readonly Installation[]
  target: Installation
  statusOf: (build: Installation) => HomeBuildStatus
}>()

const emit = defineEmits<{
  open: [build: Installation]
}>()

const { t } = useI18n()

const open = ref(false)

const sessionStore = useSessionStore()

function isLive(build: Installation): boolean {
  const status = statusOf(build)
  return status === 'running' || status === 'always-on'
}

function brokenReason(build: Installation): string | undefined {
  return build.statusTag?.style === 'danger' ? build.statusTag.label : undefined
}

function problem(build: Installation): string | undefined {
  return (
    brokenReason(build) ??
    (sessionStore.errorInstances.has(build.id) ? t('home.buildDidntStart') : undefined)
  )
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
    :tooltip="t('home.opensIn', { name: target.name })"
    :menu-label="t('home.chooseBuildToOpen')"
    main-testid="home-open-comfyui"
    menu-testid="home-open-build-menu"
    data-testid="home-open-build"
    @run="emit('open', target)"
  >
    <component
      :is="isCloudBuild(target) ? Cloud : Laptop"
      class="shrink-0"
      :size="14"
      :data-kind="isCloudBuild(target) ? 'cloud' : 'local'"
      aria-hidden="true"
      data-testid="home-open-comfyui-icon"
    />
    <span>{{ t('home.openComfyUI') }}</span>
    <span class="sr-only" data-testid="home-open-comfyui-build">{{ target.name }}</span>
    <template v-if="builds.length > 1" #menu>
      <DropdownMenuRadioGroup :model-value="target.id">
        <Tooltip v-for="build in builds" :key="build.id" :text="problem(build)" side="left">
          <BaseMenuRadioItem
            as="button"
            type="button"
            :value="build.id"
            :disabled="brokenReason(build) !== undefined"
            class="group ui-select-option w-full"
            data-testid="home-open-build-option"
            @select="emit('open', build)"
          >
            <span class="relative flex shrink-0">
              <component :is="isCloudBuild(build) ? Cloud : Laptop" :size="14" aria-hidden="true" />
              <span
                v-if="problem(build) || isLive(build)"
                class="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border-2 border-popover group-data-[state=checked]:border-[color-mix(in_srgb,var(--color-popover),white_6%)]"
                :class="problem(build) ? 'bg-destructive' : 'bg-[#59d38c]'"
                aria-hidden="true"
                data-testid="home-open-build-status-dot"
                :data-tone="problem(build) ? 'danger' : 'live'"
              />
            </span>
            <span class="min-w-0 flex-1 truncate text-left" :title="build.name">{{
              build.name
            }}</span>
          </BaseMenuRadioItem>
        </Tooltip>
      </DropdownMenuRadioGroup>
    </template>
  </SplitButton>
</template>
