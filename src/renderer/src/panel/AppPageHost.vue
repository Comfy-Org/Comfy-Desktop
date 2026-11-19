<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'
import { ChevronLeft } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import OutputDetailDialog from './OutputDetailDialog.vue'
import type { OutputDetailItem } from './OutputDetailDialog.vue'
import { useCoveredByPage } from '../composables/useCoveredByPage'
import { appPageShown, sidebarHovered } from './appPageCover'
import type {
  AppOutputAction,
  AppOutputs,
  AppPagePlacement,
  AppPageStatus,
  AssetKind
} from '../types/ipc'

const { appId, title } = defineProps<{
  appId: string
  title: string
}>()

const emit = defineEmits<{ close: []; 'view-in-assets': [name: string] }>()

const { t } = useI18n()

const host = useTemplateRef<HTMLElement>('host')
const coveredByPage = useCoveredByPage(host)
const covered = computed(() => coveredByPage.value || sidebarHovered.value)
const status = ref<AppPageStatus | null>(null)
const frozenFrame = ref<string | null>(null)
const outputs = shallowRef<OutputDetailItem[] | null>(null)
const outputIndex = ref(0)
const outputsShown = ref(0)

let justOpened = true
let retrying = false
let focusPage = false
let latestTurn = 0
let stopStatusUpdates: (() => void) | null = null
let stopOutputs: (() => void) | null = null

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
    justOpened,
    retry: retrying,
    focus: focusPage
  }
  justOpened = false
  retrying = false
  focusPage = false
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
  appPageShown.value = true
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
  appPageShown.value = false
}

function outputKind(mimeType: string): AssetKind | null {
  const kind = mimeType.split('/')[0]
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : null
}

function savedFolder(output: AppOutputs['items'][number]): string | null {
  return output.savedOn === 'computer' ? (output.folder ?? null) : null
}

function releaseOutputs(): void {
  const shown = outputs.value
  if (!shown) return
  outputs.value = null
  void nextTick(() => {
    for (const item of shown) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  })
}

function showOutputs(shown: AppOutputs): void {
  releaseOutputs()
  outputs.value = shown.items.map((output, i) => ({
    key: `${i}:${output.name}`,
    name: output.name,
    kind: outputKind(output.mimeType),
    sizeBytes: output.bytes.byteLength,
    createdAt: null,
    tags: output.tags,
    previewUrl: URL.createObjectURL(new Blob([output.bytes], { type: output.mimeType })),
    thumbnailUrl: null,
    workflow: output.workflow,
    savedIn: savedFolder(output),
    inCloud: output.savedOn === 'cloud',
    mainAction: savedFolder(output) ? null : 'download'
  }))
  outputIndex.value = shown.index
  outputsShown.value += 1
}

function closeOutputs(): void {
  if (!outputs.value) return
  focusPage = true
  releaseOutputs()
}

function sendOutputAction(action: AppOutputAction['action'], index: number): void {
  window.api.sendAppOutputAction({ action, index })
  if (action === 'open-workflow') closeOutputs()
}

function viewInAssets(index: number): void {
  const name = outputs.value?.[index]?.name
  releaseOutputs()
  if (name) emit('view-in-assets', name)
}

function retry(): void {
  status.value = 'loading'
  retrying = true
  void reveal()
}

watch(covered, (isCovered) => void (isCovered ? conceal() : reveal()))

watch(
  () => appId,
  () => {
    justOpened = true
    status.value = null
    frozenFrame.value = null
    releaseOutputs()
    if (!covered.value) void reveal()
  }
)

useResizeObserver(host, () => {
  if (!covered.value) void reveal()
})

onMounted(() => {
  stopStatusUpdates = window.api.onAppPageStatusChanged((pageAppId, next) => {
    if (pageAppId === appId) status.value = next
  })
  stopOutputs = window.api.onAppOutputs((pageAppId, shown) => {
    if (pageAppId !== appId) return
    if (shown) showOutputs(shown)
    else releaseOutputs()
  })
  if (!covered.value) void reveal()
})

onBeforeUnmount(() => {
  latestTurn += 1
  stopStatusUpdates?.()
  stopOutputs?.()
  releaseOutputs()
  window.api.hideAppPage()
  appPageShown.value = false
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
      class="flex size-full gap-2"
      data-testid="app-page-loading"
    >
      <span class="sr-only">{{ t('apps.pageLoading', { app: title }) }}</span>
      <div
        class="flex w-90 shrink-0 flex-col gap-3 rounded-shell bg-sidebar-background px-5 pt-4 pb-5"
      >
        <Skeleton class="h-6 w-2/3 rounded-md" />
        <Skeleton class="mt-2 aspect-3/2 w-full rounded-card" />
        <Skeleton class="h-4 w-1/3 rounded-md" />
        <Skeleton class="h-20 w-full rounded-card" />
        <Skeleton class="mt-auto h-10 w-full rounded-card" />
      </div>
      <div
        class="flex min-w-0 flex-1 flex-col gap-3 rounded-shell bg-sidebar-background px-5 pt-4 pb-5"
      >
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
    <OutputDetailDialog
      v-if="outputs"
      :key="outputsShown"
      v-model:index="outputIndex"
      :items="outputs"
      @close="closeOutputs"
      @download="sendOutputAction('download', $event)"
      @open-workflow="sendOutputAction('open-workflow', $event)"
      @show-in-folder="sendOutputAction('show-in-folder', $event)"
      @view-in-assets="viewInAssets"
    />
  </section>
</template>
