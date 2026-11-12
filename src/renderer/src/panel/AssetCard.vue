<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AudioLines, Box, File, Play } from 'lucide-vue-next'
import Tooltip from '../components/ui/Tooltip.vue'
import type { AssetKind } from '../types/ipc'

const {
  name,
  kind,
  imageUrl = null,
  videoUrl = null,
  layout,
  details = '',
  showName = false,
  showDetails = false,
  tooltipDelayMs,
  itemTestId
} = defineProps<{
  name: string
  kind: AssetKind | null
  imageUrl?: string | null
  videoUrl?: string | null
  layout: 'masonry' | 'grid'
  details?: string
  showName?: boolean
  showDetails?: boolean
  tooltipDelayMs: number
  itemTestId: string
}>()

defineOptions({ inheritAttrs: false })

const emit = defineEmits<{ open: [] }>()

const { t } = useI18n()
const imageFailed = ref(false)
const videoFailed = ref(false)

watch(
  () => imageUrl,
  () => (imageFailed.value = false)
)
watch(
  () => videoUrl,
  () => (videoFailed.value = false)
)

const mediaClass =
  'block w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100'

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot) : ''
}
</script>

<template>
  <li class="group relative bg-secondary" :data-testid="itemTestId">
    <Tooltip :text="name" side="bottom" :delay-ms="tooltipDelayMs" class="w-full align-top">
      <button
        type="button"
        class="block w-full cursor-pointer text-left"
        :aria-label="t('assets.inspect', { name })"
        v-bind="$attrs"
        @click="emit('open')"
      >
        <span
          class="relative block overflow-hidden"
          :class="layout === 'grid' || !imageUrl || imageFailed ? 'aspect-video' : ''"
        >
          <img
            v-if="imageUrl && !imageFailed"
            :src="imageUrl"
            :alt="name"
            loading="lazy"
            :class="[mediaClass, layout === 'grid' && 'h-full']"
            @error="imageFailed = true"
          />
          <video
            v-else-if="videoUrl && !videoFailed"
            :src="videoUrl"
            preload="metadata"
            muted
            :class="[mediaClass, 'size-full']"
            @error="videoFailed = true"
          />
          <span
            v-else
            class="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground transition-transform duration-200 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          >
            <AudioLines v-if="kind === 'audio'" :size="28" aria-hidden="true" />
            <Box v-else-if="kind === '3d'" :size="28" aria-hidden="true" />
            <File v-else :size="28" aria-hidden="true" />
            <span class="text-ui">{{ extensionOf(name) }}</span>
          </span>
          <span
            v-if="kind === 'video'"
            class="absolute bottom-2 left-2 flex size-6 items-center justify-center rounded-md bg-media-overlay text-foreground"
          >
            <Play :size="12" aria-hidden="true" />
          </span>
        </span>
        <span v-if="showName || showDetails" class="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
          <span v-if="showName" class="truncate text-ui font-medium text-foreground">{{
            name
          }}</span>
          <span v-if="showDetails" class="truncate text-ui text-subtle-foreground">{{
            details
          }}</span>
        </span>
      </button>
    </Tooltip>
    <div
      class="absolute top-2 right-2 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
    >
      <slot name="action" />
    </div>
  </li>
</template>
