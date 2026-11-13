<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import CardBottom from '@comfyorg/design-system/content-card/CardBottom'
import CardContainer from '@comfyorg/design-system/content-card/CardContainer'
import CardTop from '@comfyorg/design-system/content-card/CardTop'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import CategoryBadge from './CategoryBadge.vue'
import {
  exploreGridClass,
  useExploreCards,
  type CardSize,
  type ExploreView,
  type FilterGroup
} from './exploreCards'
import type { CatalogWorkflow } from '../types/ipc'

const SKELETON_COUNT = 8

const { view, size } = defineProps<{ view: ExploreView; size: CardSize }>()

const emit = defineEmits<{ groups: [groups: FilterGroup[]] }>()

const { t } = useI18n()
const templates = ref<CatalogWorkflow[]>([])
const loading = ref(true)
const failed = ref(false)
const { shown, groups } = useExploreCards(templates, () => view)
const gridClass = computed(() => exploreGridClass(size))
watch(groups, (value) => emit('groups', value), { immediate: true })

onMounted(async () => {
  try {
    templates.value = await window.api.listHomeWorkflows()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
})

function openTemplate(template: CatalogWorkflow): void {
  void window.api.openCatalogWorkflow(template.id)
}
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pt-2 pb-24">
    <div v-if="loading" role="status" :aria-label="t('common.loading')">
      <ul :class="gridClass" data-testid="templates-gallery-skeleton">
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
    </div>
    <p
      v-else-if="failed"
      class="m-0 text-ui text-muted-foreground"
      data-testid="templates-catalog-failed"
    >
      {{ t('explore.templatesFailed') }}
    </p>
    <p
      v-else-if="templates.length === 0"
      class="m-0 text-ui text-muted-foreground"
      data-testid="templates-empty"
    >
      {{ t('explore.templatesEmpty') }}
    </p>
    <p
      v-else-if="shown.length === 0"
      class="m-0 text-ui text-muted-foreground"
      data-testid="explore-no-matches"
    >
      {{ t('explore.noMatches') }}
    </p>
    <ul v-else :class="gridClass" data-testid="templates-gallery">
      <li v-for="template in shown" :key="template.id">
        <button
          type="button"
          class="group block w-full cursor-pointer rounded-xl text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          :aria-label="t('explore.openTemplate', { title: template.title })"
          :aria-describedby="
            template.description ? `template-card-description-${template.id}` : undefined
          "
          :data-testid="`template-card-${template.id}`"
          @click="openTemplate(template)"
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
                  v-if="template.thumbnailUrl"
                  :src="template.thumbnailUrl"
                  alt=""
                  loading="lazy"
                  class="absolute inset-0 size-full object-cover"
                />
                <CategoryBadge
                  v-if="template.category"
                  :category="template.category"
                  class="absolute top-2.5 left-2.5"
                  data-testid="explore-card-category"
                />
              </CardTop>
            </template>
            <template #bottom>
              <CardBottom>
                <span class="flex min-w-0 flex-col gap-0.5 px-2.5 pt-3 pb-2.5">
                  <span class="truncate text-ui font-medium text-foreground">
                    {{ template.title }}
                  </span>
                  <span
                    v-if="template.description"
                    :id="`template-card-description-${template.id}`"
                    class="line-clamp-2 text-ui text-muted-foreground"
                  >
                    {{ template.description }}
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
