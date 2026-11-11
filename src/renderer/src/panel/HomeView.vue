<script setup lang="ts">
import { computed, onMounted, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, ImageOff, Play } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import { useInstallList } from '../composables/useInstallList'
import { installTypeMetaForInstall } from '../lib/installTypeIcon'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { CatalogWorkflow, Installation } from '../types/ipc'

type LoadState = 'loading' | 'ready' | 'unavailable'

interface FanSlot {
  left: number
  top: number
  width: number
  height: number
}

const HOME_BUILD_LIMIT = 3
const FAN_WIDTH = 644
const FAN_HEIGHT = 246
const FAN_SLOTS: readonly FanSlot[] = [
  { left: 0, top: 10, width: 196, height: 236 },
  { left: 122, top: 5, width: 177, height: 223 },
  { left: 244, top: 0, width: 156, height: 208 },
  { left: 346, top: 5, width: 177, height: 223 },
  { left: 448, top: 10, width: 196, height: 236 }
]
const SECTION_TITLE_CLASS = 'm-0 text-[13px]/5 font-semibold text-foreground'
const SECTION_LINK_CLASS =
  'h-6 gap-1.5 rounded-[7px] px-1.5 text-[13px]/5 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground'
const FAN_CARD_CLASS =
  'absolute overflow-hidden rounded-xl border border-white/10 bg-foreground/5 shadow-[0_18px_40px_rgb(0_0_0/0.8)]'

const emit = defineEmits<{
  pick: [installation: Installation]
  'show-builds': []
}>()

const { t } = useI18n()
const installationStore = useInstallationStore()
const sessionStore = useSessionStore()

const { visibleInstalls } = useInstallList({
  installations: toRef(installationStore, 'installations')
})
const builds = computed(() => visibleInstalls.value.slice(0, HOME_BUILD_LIMIT))
const mostRecentBuild = computed(() => visibleInstalls.value[0] ?? null)

const state = ref<LoadState>('loading')
const workflows = ref<CatalogWorkflow[]>([])
const brokenThumbnails = ref(new Set<string>())

const fannedWorkflows = computed(() => {
  const shown = workflows.value.slice(0, FAN_SLOTS.length)
  const firstSlot = Math.floor((FAN_SLOTS.length - shown.length) / 2)
  return shown.map((workflow, index) => ({ workflow, slot: FAN_SLOTS[firstSlot + index]! }))
})

function slotStyle(slot: FanSlot): Record<string, string> {
  return {
    left: `${slot.left}px`,
    top: `${slot.top}px`,
    width: `${slot.width}px`,
    height: `${slot.height}px`
  }
}

function buildStatus(build: Installation): { label: string; live: boolean } {
  if (sessionStore.isRunning(build.id)) return { label: t('home.buildRunning'), live: true }
  if (sessionStore.isLaunching(build.id)) return { label: t('home.buildStarting'), live: false }
  if (build.statusTag?.style === 'update') {
    return { label: build.statusTag.label || t('chooser.updatePill'), live: false }
  }
  return { label: t(installTypeMetaForInstall(build).labelKey), live: false }
}

async function loadWorkflows(): Promise<void> {
  state.value = 'loading'
  try {
    workflows.value = await window.api.listHomeWorkflows()
    state.value = workflows.value.length > 0 ? 'ready' : 'unavailable'
  } catch {
    workflows.value = []
    state.value = 'unavailable'
  }
}

function showsThumbnail(workflow: CatalogWorkflow): boolean {
  return workflow.thumbnailUrl !== null && !brokenThumbnails.value.has(workflow.id)
}

function markThumbnailBroken(workflow: CatalogWorkflow): void {
  brokenThumbnails.value = new Set(brokenThumbnails.value).add(workflow.id)
}

function openWorkflow(workflow: CatalogWorkflow): void {
  void window.api.openCatalogWorkflow(workflow.id)
}

function exploreAllWorkflows(): void {
  void window.api.openCatalogWorkflowHub()
}

onMounted(() => {
  void loadWorkflows()
  if (installationStore.installations.length === 0) void installationStore.fetchInstallations()
})
</script>

<template>
  <div
    class="home-view relative flex min-h-0 w-full flex-auto flex-col overflow-y-auto"
    :class="PAGE_SPOTLIGHT_CLASS"
    data-testid="home-view"
  >
    <Button
      v-if="mostRecentBuild"
      type="button"
      variant="inverted"
      size="md"
      class="absolute top-3.5 right-4 z-10 gap-1.5 px-3 text-[13px]/5 font-medium"
      data-testid="home-open-comfyui"
      @click="emit('pick', mostRecentBuild)"
    >
      <Play :size="13" aria-hidden="true" />
      {{ t('home.openComfyUI') }}
    </Button>

    <div class="mx-auto w-full max-w-300 px-10 pb-24">
      <header class="flex h-[226px] items-end justify-center pb-[38px]">
        <h1 class="m-0 text-[34px]/10 font-semibold tracking-[-0.055em] text-foreground">
          {{ t('home.title') }}
        </h1>
      </header>

      <section v-if="builds.length > 0" aria-labelledby="home-builds" data-testid="home-builds">
        <div class="mb-3 flex h-6 items-center justify-between">
          <h2 id="home-builds" :class="SECTION_TITLE_CLASS">{{ t('sidebar.builds') }}</h2>
          <Button
            type="button"
            variant="muted-textonly"
            size="unset"
            :class="SECTION_LINK_CLASS"
            data-testid="home-all-builds"
            @click="emit('show-builds')"
          >
            {{ t('home.allBuilds') }}
            <ChevronRight :size="13" aria-hidden="true" />
          </Button>
        </div>
        <ul class="m-0 grid list-none grid-cols-3 gap-3.5 p-0">
          <li v-for="build in builds" :key="build.id" class="min-w-0">
            <button
              type="button"
              class="flex h-18 w-full cursor-pointer items-center gap-3.5 rounded-2xl border-0 bg-foreground/5 px-[17px] text-left shadow-[0_1px_2px_rgb(0_0_0/0.12),0_6px_16px_rgb(0_0_0/0.18)] outline-none transition-colors hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="home-build"
              @click="emit('pick', build)"
            >
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-foreground/7 text-foreground/60"
              >
                <component
                  :is="installTypeMetaForInstall(build).icon"
                  :size="18"
                  aria-hidden="true"
                />
              </span>
              <span class="flex min-w-0 flex-col">
                <span class="truncate text-[13px]/5 font-medium text-foreground">
                  {{ build.name }}
                </span>
                <span class="flex items-center gap-1.5 text-[13px]/5 text-subtle-foreground">
                  <span
                    v-if="buildStatus(build).live"
                    class="size-1.5 shrink-0 rounded-full bg-[#59d38c] shadow-[0_0_0_3px_rgb(89_211_140/0.41)]"
                    aria-hidden="true"
                  />
                  <span class="truncate">{{ buildStatus(build).label }}</span>
                </span>
              </span>
            </button>
          </li>
        </ul>
      </section>

      <section class="mt-8" aria-labelledby="home-example-workflows">
        <div class="mx-auto mb-7.5 flex h-6 max-w-[720px] items-center gap-3">
          <h2 id="home-example-workflows" :class="SECTION_TITLE_CLASS">
            {{ t('home.exampleWorkflows') }}
          </h2>
          <span
            v-if="state === 'ready'"
            class="rounded-full bg-[#2d2d2d]/82 px-2 text-[13px]/5 text-muted-foreground"
            data-testid="home-workflow-count"
          >
            {{ workflows.length }}
          </span>
          <Button
            type="button"
            variant="muted-textonly"
            size="unset"
            class="ml-auto"
            :class="SECTION_LINK_CLASS"
            data-testid="home-explore-workflows"
            @click="exploreAllWorkflows"
          >
            {{ t('home.exploreAll') }}
            <ChevronRight :size="13" aria-hidden="true" />
          </Button>
        </div>

        <div
          v-if="state === 'unavailable'"
          class="mx-auto flex max-w-[720px] flex-col items-start gap-3 rounded-2xl bg-foreground/5 px-5 py-6"
          data-testid="home-workflows-unavailable"
        >
          <p class="m-0 text-[13px]/5 text-muted-foreground">
            {{ t('home.workflowsUnavailable') }}
          </p>
          <Button type="button" variant="secondary" size="md" @click="loadWorkflows">
            {{ t('home.retry') }}
          </Button>
        </div>

        <div
          v-else
          class="relative mx-auto"
          :style="{ width: `${FAN_WIDTH}px`, height: `${FAN_HEIGHT}px` }"
        >
          <template v-if="state === 'loading'">
            <div class="contents" aria-busy="true" data-testid="home-workflows-loading">
              <Skeleton
                v-for="(slot, index) in FAN_SLOTS"
                :key="index"
                class="absolute rounded-xl"
                :style="slotStyle(slot)"
              />
            </div>
          </template>
          <ul v-else class="m-0 list-none p-0">
            <li v-for="{ workflow, slot } in fannedWorkflows" :key="workflow.id">
              <button
                type="button"
                class="group cursor-pointer p-0 text-left outline-none transition-transform duration-200 ease-out hover:z-10 hover:-translate-y-1.5 focus-visible:z-10 focus-visible:-translate-y-1.5 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                :class="FAN_CARD_CLASS"
                :style="slotStyle(slot)"
                :aria-label="t('home.openWorkflow', { title: workflow.title })"
                data-testid="home-workflow-card"
                @click="openWorkflow(workflow)"
              >
                <img
                  v-if="showsThumbnail(workflow)"
                  :src="workflow.thumbnailUrl ?? undefined"
                  alt=""
                  class="absolute inset-0 size-full object-cover"
                  @error="markThumbnailBroken(workflow)"
                />
                <span
                  v-else
                  class="absolute inset-0 flex items-center justify-center text-subtle-foreground"
                >
                  <ImageOff :size="22" aria-hidden="true" />
                </span>
                <span
                  class="absolute inset-0 bg-linear-to-b from-transparent from-45% to-black/75"
                  aria-hidden="true"
                />
                <span
                  class="absolute inset-0 bg-[linear-gradient(115deg,transparent_40%,rgb(255_255_255/0.07)_50%,transparent_60%)]"
                  aria-hidden="true"
                />
                <span
                  class="absolute bottom-4 left-3.5 line-clamp-3 w-[84px] text-[13px]/[18px] font-medium text-white"
                >
                  {{ workflow.title }}
                </span>
              </button>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </div>
</template>
