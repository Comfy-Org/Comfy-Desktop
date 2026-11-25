<script setup lang="ts">
import { computed, nextTick, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePreferredReducedMotion } from '@vueuse/core'
import { AppWindow, LoaderCircle } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Tooltip from '../components/ui/Tooltip.vue'
import CoverRotation from '../components/CoverRotation.vue'
import { stillsOf } from '../../../shared/appStills'
import { finishedAppIds, runningAppIds } from './appRuns'
import type { AppCard } from '../types/ipc'

const { currentApp, apps, label } = defineProps<{
  currentApp: AppCard | null
  apps: AppCard[] | null
  label: string
}>()

const emit = defineEmits<{
  'switch-app': [app: AppCard]
}>()

const { t } = useI18n()
const motion = usePreferredReducedMotion()
const brokenStills = reactive(new Set<string>())
const brokenCovers = reactive(new Set<string>())
const rows = new Map<string, HTMLElement>()

const listedApps = computed(() => {
  if (!apps) return []
  if (!currentApp || apps.some((app) => app.id === currentApp.id)) return apps
  return [currentApp, ...apps]
})

function isCurrent(app: AppCard): boolean {
  return app.id === currentApp?.id
}

function isRunning(app: AppCard): boolean {
  return runningAppIds.value.has(app.id)
}

function isFinished(app: AppCard): boolean {
  return !isRunning(app) && finishedAppIds.value.has(app.id)
}

function labelOf(app: AppCard): string {
  if (isRunning(app)) return t('apps.rail.running', { app: app.title })
  if (isFinished(app)) return t('apps.rail.finished', { app: app.title })
  return app.title
}

function stillOf(app: AppCard): string | undefined {
  return brokenStills.has(app.id) ? undefined : stillsOf(app)[0]
}

function showsCover(app: AppCard): boolean {
  return app.covers.length > 0 && !brokenCovers.has(app.id)
}

function rememberRow(appId: string, element: unknown): void {
  if (element instanceof HTMLElement) rows.set(appId, element)
  else rows.delete(appId)
}

function pick(app: AppCard): void {
  if (!isCurrent(app)) emit('switch-app', app)
}

watch(
  () => [currentApp?.id, listedApps.value.length] as const,
  async ([appId]) => {
    if (!appId) return
    await nextTick()
    rows.get(appId)?.scrollIntoView({
      block: 'nearest',
      behavior: motion.value === 'reduce' ? 'instant' : 'smooth'
    })
  },
  { immediate: true }
)
</script>

<template>
  <nav
    class="-mx-3 mt-0.5 flex min-h-0 flex-1 scrollbar-hide flex-col overflow-x-hidden overflow-y-auto px-3 pt-1.5"
    :aria-label="label"
    data-testid="app-sidebar-app-rail"
  >
    <ul class="m-0 flex list-none flex-col gap-2 p-0">
      <li
        v-for="app in listedApps"
        :key="app.id"
        :ref="(element) => rememberRow(app.id, element)"
        class="group/thumb relative flex shrink-0"
      >
        <span
          class="pointer-events-none absolute top-1/2 -left-3 w-[3px] -translate-y-1/2 rounded-r-full bg-foreground transition-[height,opacity] duration-200 ease-out motion-reduce:transition-none"
          :class="
            isCurrent(app)
              ? 'h-5 opacity-100'
              : 'h-2 opacity-0 group-hover/thumb:opacity-100 group-has-[:focus-visible]/thumb:opacity-100'
          "
          aria-hidden="true"
        />
        <span
          class="relative ml-1 flex size-8"
          :class="{ 'animate-rail-thumb-bounce motion-reduce:animate-none': isFinished(app) }"
          :data-testid="isFinished(app) ? `app-sidebar-app-finished-${app.id}` : undefined"
        >
          <Tooltip :text="app.title" side="right" :delay-ms="0" class="size-8">
            <Button
              variant="textonly"
              size="unset"
              class="relative size-full overflow-hidden rounded-lg p-0 transition-[scale,opacity] duration-150 ease-out hover:bg-transparent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring active:scale-94 motion-reduce:transition-none"
              :class="isCurrent(app) ? 'opacity-100' : 'opacity-70 hover:opacity-100'"
              :aria-label="labelOf(app)"
              :aria-current="isCurrent(app) ? 'page' : undefined"
              :data-testid="`app-sidebar-app-${app.id}`"
              @click="pick(app)"
            >
              <img
                v-if="stillOf(app)"
                :src="stillOf(app)"
                alt=""
                class="size-full object-cover"
                draggable="false"
                @error="brokenStills.add(app.id)"
              />
              <span
                v-else
                class="grid size-full place-items-center bg-secondary text-muted-foreground"
              >
                <AppWindow :size="15" aria-hidden="true" />
              </span>
              <span
                v-if="isRunning(app)"
                class="absolute inset-0 grid place-items-center bg-background/60 text-foreground"
                :data-testid="`app-sidebar-app-running-${app.id}`"
                aria-hidden="true"
              >
                <LoaderCircle
                  :size="14"
                  class="animate-spin [animation-duration:900ms] motion-reduce:animate-none"
                />
              </span>
            </Button>
            <template #content>
              <span class="flex w-[200px] flex-col gap-1.5 py-1">
                <span
                  v-if="showsCover(app)"
                  class="relative block aspect-[4/3] w-full overflow-hidden rounded-[5px]"
                  data-testid="app-sidebar-app-preview"
                >
                  <CoverRotation :pictures="app.covers" @broken="brokenCovers.add(app.id)" />
                </span>
                <span>{{ app.title }}</span>
              </span>
            </template>
          </Tooltip>
          <span
            v-if="isFinished(app)"
            class="pointer-events-none absolute -top-0.5 -right-0.5 size-2 rounded-full bg-foreground ring-2 ring-sidebar-background"
            aria-hidden="true"
          />
        </span>
      </li>
    </ul>
  </nav>
</template>
