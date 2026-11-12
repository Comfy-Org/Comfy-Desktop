<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SelectTrigger } from 'reka-ui'
import { ArrowRight, ChevronDown } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Select from '@comfyorg/design-system/select/Select'
import SelectContent from '@comfyorg/design-system/select/SelectContent'
import SelectItem from '@comfyorg/design-system/select/SelectItem'
import BuildDeviceArt from './BuildDeviceArt.vue'
import { HOME_BUILD_TONES, homeBuildTones, isCloudBuild, type HomeBuildStatus } from './homeBuild'
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
const tones = computed(() => homeBuildTones(builds))

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

function pick(id: unknown): void {
  const build = builds.find((candidate) => candidate.id === id)
  if (build) emit('select', build)
}

let suppressFocusReturn = false
function onWindowBlur(): void {
  if (!open.value) return
  suppressFocusReturn = true
  open.value = false
}
function onCloseAutoFocus(event: Event): void {
  if (suppressFocusReturn) event.preventDefault()
  suppressFocusReturn = false
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  open.value = false
}
onMounted(() => window.addEventListener('blur', onWindowBlur))
onBeforeUnmount(() => window.removeEventListener('blur', onWindowBlur))
</script>

<template>
  <div class="inline-flex items-stretch" data-testid="home-open-build">
    <Button
      type="button"
      variant="inverted"
      size="md"
      class="max-w-80 gap-1.5 px-3 text-[13px]/5 font-medium"
      :class="builds.length > 1 && 'rounded-r-none pr-2'"
      data-testid="home-open-comfyui"
      @click="emit('open', target)"
    >
      <span class="shrink-0">{{ t('home.openComfyUI') }}</span>
      <span class="min-w-0 truncate opacity-55" data-testid="home-open-comfyui-build">
        {{ target.name }}
      </span>
      <ArrowRight class="shrink-0" :size="14" aria-hidden="true" />
    </Button>
    <Select
      v-if="builds.length > 1"
      v-model:open="open"
      :model-value="target.id"
      @update:model-value="pick"
    >
      <SelectTrigger as-child>
        <Button
          type="button"
          variant="inverted"
          size="md"
          class="rounded-l-none pr-2.5 pl-1"
          :aria-label="t('home.chooseBuildToOpen')"
          data-testid="home-open-build-menu"
        >
          <ChevronDown
            class="transition-transform duration-200 motion-reduce:transition-none"
            :class="open && 'rotate-180'"
            :size="14"
            aria-hidden="true"
          />
        </Button>
      </SelectTrigger>
      <SelectContent
        class="ui-select-listbox ui-select-listbox--compact z-[9999] mt-0 max-h-[min(280px,var(--reka-select-content-available-height))] w-min min-w-60 bg-popover [overflow-wrap:anywhere]"
        align="end"
        :side-offset="2"
        :collision-padding="8"
        :aria-label="t('home.chooseBuildToOpen')"
        :body-lock="false"
        :disable-outside-pointer-events="false"
        @keydown.capture="onKeydown"
        @close-auto-focus="onCloseAutoFocus"
      >
        <SelectItem
          v-for="(build, index) in builds"
          :key="build.id"
          :value="build.id"
          :text-value="build.name"
          class="ui-select-option gap-2.5 py-1.5 text-xs [&>span:last-child]:hidden"
          text-class="min-w-0 flex-auto"
          data-testid="home-open-build-option"
        >
          <span class="flex min-w-0 items-center gap-2.5">
            <BuildDeviceArt
              class="h-[15px] w-[23px] shrink-0"
              :kind="isCloudBuild(build) ? 'cloud' : 'laptop'"
              :glow="HOME_BUILD_TONES[tones[index]!].glow"
            />
            <span class="ui-select-option-label min-w-0 flex-auto truncate">{{ build.name }}</span>
            <span class="shrink-0 text-muted-foreground" data-testid="home-open-build-status">
              {{ statusLabel(build) }}
            </span>
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
