<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'
import { ChevronLeft } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import { useCoveredByPage } from '../composables/useCoveredByPage'
import type { AppPagePlacement, AppPageStatus } from '../types/ipc'

const { appId, title } = defineProps<{
  appId: string
  title: string
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const host = useTemplateRef<HTMLElement>('host')
const covered = useCoveredByPage(host)
const status = ref<AppPageStatus | null>(null)
const frozenFrame = ref<string | null>(null)

let justOpened = true
let latestTurn = 0
let stopStatusUpdates: (() => void) | null = null

function takePlacement(): AppPagePlacement | null {
  const element = host.value
  if (!element) return null
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const cornerRadius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
  const placement = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    cornerRadius,
    justOpened
  }
  justOpened = false
  return placement
}

function decoded(source: string): Promise<void> {
  const image = new Image()
  image.src = source
  return image.decode().catch(() => {})
}

async function reveal(): Promise<void> {
  const turn = ++latestTurn
  const placement = takePlacement()
  if (!placement) return
  const shown = await window.api.showAppPage(appId, placement)
  if (turn !== latestTurn) return
  status.value = shown
}

async function conceal(): Promise<void> {
  const turn = ++latestTurn
  const frame = status.value === 'ready' ? await window.api.captureAppPage() : null
  if (turn !== latestTurn) return
  if (frame) await decoded(frame)
  if (turn !== latestTurn) return
  frozenFrame.value = frame
  await nextTick()
  if (turn !== latestTurn) return
  window.api.hideAppPage()
}

function retry(): void {
  status.value = 'loading'
  window.api.reloadAppPage()
}

watch(covered, (isCovered) => void (isCovered ? conceal() : reveal()))

watch(
  () => appId,
  () => {
    justOpened = true
    status.value = null
    frozenFrame.value = null
    if (!covered.value) void reveal()
  }
)

useResizeObserver(host, () => {
  if (!covered.value) void reveal()
})

onMounted(() => {
  stopStatusUpdates = window.api.onAppPageStatusChanged((next) => {
    status.value = next
  })
  if (!covered.value) void reveal()
})

onBeforeUnmount(() => {
  latestTurn += 1
  stopStatusUpdates?.()
  window.api.hideAppPage()
})
</script>

<template>
  <section
    ref="host"
    class="relative min-h-0 w-full flex-auto overflow-hidden rounded-shell"
    :aria-label="title"
    :aria-busy="status === 'loading'"
    :data-status="status ?? 'pending'"
    data-testid="app-page-host"
  >
    <img
      v-if="status === 'ready' && frozenFrame"
      :src="frozenFrame"
      alt=""
      aria-hidden="true"
      class="absolute inset-0 size-full"
      data-testid="app-page-frozen-frame"
    />
    <div
      v-else-if="status === 'loading'"
      class="flex size-full gap-3 p-3"
      data-testid="app-page-loading"
    >
      <span class="sr-only">{{ t('apps.pageLoading', { app: title }) }}</span>
      <div class="flex w-90 shrink-0 flex-col gap-3 rounded-panel bg-[rgb(29_29_29/0.72)] p-4">
        <Skeleton class="h-6 w-2/3 rounded-md" />
        <Skeleton class="mt-2 aspect-3/2 w-full rounded-card" />
        <Skeleton class="h-4 w-1/3 rounded-md" />
        <Skeleton class="h-20 w-full rounded-card" />
        <Skeleton class="mt-auto h-10 w-full rounded-card" />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-3 rounded-panel bg-[rgb(29_29_29/0.72)] p-4">
        <Skeleton class="h-8 w-48 rounded-lg" />
        <Skeleton class="min-h-0 w-full flex-1 rounded-card opacity-60" />
      </div>
    </div>
    <div
      v-else-if="status === 'failed'"
      class="flex size-full flex-col items-center justify-center gap-3 px-10 text-center"
      data-testid="app-page-failed"
    >
      <h1 class="m-0 text-heading font-semibold text-foreground">
        {{ t('apps.pageFailedTitle', { app: title }) }}
      </h1>
      <p class="m-0 max-w-90 text-ui text-muted-foreground">
        {{ t('apps.failedBody') }}
      </p>
      <div class="mt-1 flex items-center gap-2">
        <Button
          type="button"
          variant="muted-textonly"
          size="md"
          class="gap-1.5"
          data-testid="app-page-back"
          @click="emit('close')"
        >
          <ChevronLeft :size="15" aria-hidden="true" />
          {{ t('apps.allApps') }}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          data-testid="app-page-retry"
          @click="retry"
        >
          {{ t('apps.retry') }}
        </Button>
      </div>
    </div>
  </section>
</template>
