<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppsGallery from './AppsGallery.vue'
import AppsHost from './AppsHost.vue'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import type { CatalogApp } from '../types/ipc'

const { growBy = 0 } = defineProps<{
  growBy?: number
}>()

const emit = defineEmits<{
  'app-open': [open: boolean]
  'app-entered': [entered: boolean]
}>()

const { t } = useI18n()
const loadFailedUrl = ref<string | null>(null)
const openApp = ref<CatalogApp | null>(null)
const appEntered = ref(false)

watch(openApp, (app) => {
  if (!app) appEntered.value = false
  emit('app-open', app !== null)
})
watch(appEntered, (entered) => emit('app-entered', entered))

const appFillsPage = computed(() => openApp.value !== null && appEntered.value)

function openCatalogApp(app: CatalogApp): void {
  loadFailedUrl.value = null
  openApp.value = app
}

function closeApp(open: boolean): void {
  if (!open) openApp.value = null
}

function appFailed(url: string): void {
  openApp.value = null
  loadFailedUrl.value = url
}

onBeforeUnmount(() => {
  if (openApp.value) emit('app-open', false)
  if (appEntered.value) emit('app-entered', false)
})
</script>

<template>
  <div
    class="flex min-h-0 w-full flex-auto flex-col overflow-y-auto"
    :class="PAGE_SPOTLIGHT_CLASS"
    data-testid="apps-view"
  >
    <header v-if="!appFillsPage" class="mx-auto w-full max-w-300 px-10 pt-9 pb-3">
      <h1 class="m-0 font-display text-display font-semibold text-foreground">
        {{ t('sidebar.apps') }}
      </h1>
    </header>
    <AppsGallery v-show="!appFillsPage" :load-failed-url="loadFailedUrl" @open="openCatalogApp" />
  </div>
  <AppsHost
    v-if="openApp"
    :key="openApp.id"
    class="absolute inset-0"
    :url="openApp.url"
    :grow-by="growBy"
    @failed="appFailed"
    @app-open="closeApp"
    @entered="appEntered = true"
  />
</template>
