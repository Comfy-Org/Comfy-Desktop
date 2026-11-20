<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Tooltip from '../components/ui/Tooltip.vue'
import AppCoverPreview from './AppCoverPreview.vue'
import { stillsOf } from '../lib/appStills'
import { SIDEBAR_FACE_BUTTON_CLASS, SIDEBAR_HEADER_CLASS } from './sidebarClasses'
import type { AppCard } from '../types/ipc'

const { currentApp, apps } = defineProps<{
  currentApp: AppCard | null
  apps: AppCard[] | null
}>()

const emit = defineEmits<{
  'all-apps': []
  'all-apps-menu': [event: MouseEvent]
  'switch-app': [app: AppCard]
}>()

const { t } = useI18n()
const brokenStills = reactive(new Set<string>())

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

function movingOf(app: AppCard): string | undefined {
  return app.covers.find((cover) => cover.stillUrl && cover.url !== cover.stillUrl)?.url
}

function pick(app: AppCard): void {
  if (!isCurrent(app)) emit('switch-app', app)
}
</script>

<template>
  <div :class="SIDEBAR_HEADER_CLASS">
    <Button
      variant="muted-textonly"
      size="unset"
      class="left-[5px] transition-[scale,background-color,color] duration-150 ease-out active:scale-90 motion-reduce:transition-none"
      :class="SIDEBAR_FACE_BUTTON_CLASS"
      :aria-label="t('apps.allApps')"
      data-testid="app-sidebar-all-apps"
      @click="emit('all-apps')"
      @contextmenu.prevent="emit('all-apps-menu', $event)"
    >
      <Tooltip
        :text="t('apps.allApps')"
        side="right"
        :delay-ms="0"
        class="size-full items-center justify-center"
      >
        <AppWindow :size="17" aria-hidden="true" />
      </Tooltip>
    </Button>
  </div>

  <nav
    class="-mx-3 flex min-h-0 flex-1 scrollbar-hide flex-col overflow-x-hidden overflow-y-auto px-3"
    :aria-label="t('sidebar.apps')"
    data-testid="app-sidebar-app-rail"
  >
    <ul class="m-0 flex list-none flex-col gap-2 p-0">
      <li v-for="app in listedApps" :key="app.id" class="group/thumb relative flex shrink-0">
        <span
          class="pointer-events-none absolute top-1/2 -left-3 w-[3px] -translate-y-1/2 rounded-r-full bg-foreground transition-[height,opacity] duration-200 ease-out motion-reduce:transition-none"
          :class="
            isCurrent(app) ? 'h-5 opacity-100' : 'h-2 opacity-0 group-hover/thumb:opacity-100'
          "
          aria-hidden="true"
        />
        <Button
          variant="textonly"
          size="unset"
          class="ml-1 size-8 overflow-hidden rounded-lg p-0 transition-[scale,opacity] duration-150 ease-out hover:bg-transparent active:scale-[0.88] motion-reduce:transition-none"
          :class="isCurrent(app) ? 'opacity-100' : 'opacity-70 hover:opacity-100'"
          :aria-label="app.title"
          :aria-current="isCurrent(app) ? 'page' : undefined"
          :data-testid="`app-sidebar-app-${app.id}`"
          @click="pick(app)"
        >
          <Tooltip :text="app.title" side="right" :delay-ms="0" class="size-full">
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
            <template #content>
              <AppCoverPreview :title="app.title" :still="stillOf(app)" :moving="movingOf(app)" />
            </template>
          </Tooltip>
        </Button>
      </li>
    </ul>
  </nav>
</template>
