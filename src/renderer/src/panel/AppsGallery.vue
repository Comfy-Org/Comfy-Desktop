<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import CardBottom from '@comfyorg/design-system/content-card/CardBottom'
import CardContainer from '@comfyorg/design-system/content-card/CardContainer'
import CardTop from '@comfyorg/design-system/content-card/CardTop'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import type { CatalogApp } from '../types/ipc'

const SKELETON_COUNT = 8
const GRID_CLASS = 'm-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 p-0'

defineProps<{
  loadFailedUrl: string | null
}>()

const emit = defineEmits<{
  open: [app: CatalogApp]
}>()

const { t } = useI18n()
const apps = ref<CatalogApp[]>([])
const loading = ref(true)
const failed = ref(false)

onMounted(async () => {
  try {
    apps.value = await window.api.listCatalogApps()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pt-2 pb-24">
    <p
      v-if="loadFailedUrl"
      class="mt-0 mb-4 text-ui text-muted-foreground"
      data-testid="apps-load-failed"
    >
      {{ t('apps.loadFailed', { url: loadFailedUrl }) }}
    </p>
    <ul
      v-if="loading"
      role="status"
      :aria-label="t('common.loading')"
      :class="GRID_CLASS"
      data-testid="apps-gallery-skeleton"
    >
      <li
        v-for="n in SKELETON_COUNT"
        :key="n"
        class="flex flex-col gap-2 rounded-xl bg-secondary p-1.5 pb-4"
      >
        <Skeleton class="aspect-video w-full rounded-lg" />
        <Skeleton class="mx-2.5 mt-2 h-3 w-1/2 rounded-full" />
        <Skeleton class="mx-2.5 h-2.5 w-3/4 rounded-full" />
      </li>
    </ul>
    <p
      v-else-if="failed"
      class="m-0 text-ui text-muted-foreground"
      data-testid="apps-catalog-failed"
    >
      {{ t('apps.catalogFailed') }}
    </p>
    <p
      v-else-if="apps.length === 0"
      class="m-0 text-ui text-muted-foreground"
      data-testid="apps-coming-soon"
    >
      {{ t('sidebar.comingSoon') }}
    </p>
    <ul v-else :class="GRID_CLASS" data-testid="apps-gallery">
      <li v-for="app in apps" :key="app.id">
        <button
          type="button"
          class="group block w-full cursor-pointer rounded-xl text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          :data-testid="`app-card-${app.id}`"
          @click="emit('open', app)"
        >
          <CardContainer
            size="auto"
            rounded="xl"
            :has-border="false"
            :has-shadow="false"
            class="p-1.5 transition-colors duration-150 group-hover:bg-accent"
          >
            <template #top>
              <CardTop ratio="landscape" class="rounded-lg bg-secondary">
                <img
                  v-if="app.thumbnailUrl"
                  :src="app.thumbnailUrl"
                  alt=""
                  loading="lazy"
                  class="absolute inset-0 size-full object-cover"
                />
              </CardTop>
            </template>
            <template #bottom>
              <CardBottom>
                <span class="flex min-w-0 flex-col gap-0.5 px-2.5 pt-3 pb-2.5">
                  <span class="truncate text-ui font-medium text-foreground">
                    {{ app.title }}
                  </span>
                  <span v-if="app.description" class="line-clamp-2 text-ui text-muted-foreground">
                    {{ app.description }}
                  </span>
                </span>
              </CardBottom>
            </template>
          </CardContainer>
        </button>
      </li>
    </ul>
  </div>
</template>
