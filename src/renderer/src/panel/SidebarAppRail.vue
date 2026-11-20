<script setup lang="ts">
import { computed, nextTick, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePreferredReducedMotion } from '@vueuse/core'
import { AppWindow } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Tooltip from '../components/ui/Tooltip.vue'
import CoverRotation from '../components/CoverRotation.vue'
import { stillsOf } from '../lib/appStills'
import type { AppCard } from '../types/ipc'

const { currentApp, apps } = defineProps<{
  currentApp: AppCard | null
  apps: AppCard[] | null
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
    class="-mx-3 mt-2 flex min-h-0 flex-1 scrollbar-hide flex-col overflow-x-hidden overflow-y-auto px-3"
    :aria-label="t('sidebar.apps')"
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
        <Tooltip :text="app.title" side="right" :delay-ms="0" class="ml-1 size-8">
          <Button
            variant="textonly"
            size="unset"
            class="size-full overflow-hidden rounded-lg p-0 transition-[scale,opacity] duration-150 ease-out hover:bg-transparent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring active:scale-94 motion-reduce:transition-none"
            :class="isCurrent(app) ? 'opacity-100' : 'opacity-70 hover:opacity-100'"
            :aria-label="app.title"
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
      </li>
    </ul>
  </nav>
</template>
