<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Tooltip from '../components/ui/Tooltip.vue'
import { stillsOf } from '../lib/appStills'
import type { AppCard } from '../types/ipc'

const { currentApp } = defineProps<{ currentApp: AppCard | null }>()

const emit = defineEmits<{
  'all-apps': []
  'all-apps-menu': [event: MouseEvent]
  'switch-app': [app: AppCard]
}>()

const { t } = useI18n()
const apps = ref<AppCard[]>([])
const brokenStills = reactive(new Set<string>())

onMounted(async () => {
  apps.value = await window.api.listApps().catch(() => [])
})

const listedApps = computed(() => {
  if (!currentApp || apps.value.some((app) => app.id === currentApp.id)) return apps.value
  return [currentApp, ...apps.value]
})

function isCurrent(app: AppCard): boolean {
  return app.id === currentApp?.id
}

function stillOf(app: AppCard): string | undefined {
  return brokenStills.has(app.id) ? undefined : stillsOf(app)[0]
}

function pick(app: AppCard): void {
  if (!isCurrent(app)) emit('switch-app', app)
}
</script>

<template>
  <div class="relative mt-2 mb-3.5 h-9 w-full shrink-0">
    <Button
      variant="muted-textonly"
      size="unset"
      class="absolute inset-y-0 left-[5px] my-auto size-[30px] rounded-[7px] p-0 transition-[scale,background-color,color] duration-150 ease-out hover:bg-secondary hover:text-foreground active:scale-90 motion-reduce:transition-none"
      :aria-label="t('apps.allApps')"
      data-testid="app-sidebar-all-apps"
      @click="emit('all-apps')"
      @contextmenu.prevent="emit('all-apps-menu', $event)"
    >
      <Tooltip :text="t('apps.allApps')" side="right" class="size-full items-center justify-center">
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
          <Tooltip :text="app.title" side="right" class="size-full">
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
              <span class="flex w-[200px] flex-col gap-1.5 py-1">
                <img
                  v-if="stillOf(app)"
                  :src="stillOf(app)"
                  alt=""
                  class="aspect-[4/3] w-full rounded-[5px] object-cover"
                  data-testid="app-sidebar-app-preview"
                />
                <span>{{ app.title }}</span>
              </span>
            </template>
          </Tooltip>
        </Button>
      </li>
    </ul>
  </nav>
</template>
