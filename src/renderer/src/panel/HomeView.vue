<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpRight, ImageOff } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import type { CatalogWorkflow } from '../types/ipc'

type LoadState = 'loading' | 'ready' | 'unavailable'

const SKELETON_CARD_COUNT = 6
const CARD_GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(188px,1fr))] gap-4'
const CARD_SHAPE_CLASS = 'aspect-4/5 w-full rounded-xl'

const { t } = useI18n()

const state = ref<LoadState>('loading')
const workflows = ref<CatalogWorkflow[]>([])
const brokenThumbnails = ref(new Set<string>())

async function load(): Promise<void> {
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

function open(workflow: CatalogWorkflow): void {
  void window.api.openCatalogWorkflow(workflow.id)
}

onMounted(load)
</script>

<template>
  <div
    class="home-view flex min-h-0 w-full flex-auto flex-col overflow-y-auto"
    :class="PAGE_SPOTLIGHT_CLASS"
    data-testid="home-view"
  >
    <div class="mx-auto w-full max-w-300 px-10 pb-24">
      <header class="pt-9 pb-6">
        <h1 class="m-0 text-[22px]/[1.4] font-semibold tracking-[-0.01em] text-foreground">
          {{ t('home.title') }}
        </h1>
      </header>

      <section aria-labelledby="home-example-workflows">
        <div class="mb-4 flex min-h-8 items-center gap-2">
          <h2 id="home-example-workflows" class="m-0 text-[13px]/5 font-semibold text-foreground">
            {{ t('home.exampleWorkflows') }}
          </h2>
          <span
            v-if="state === 'ready'"
            class="rounded-full bg-secondary px-2 text-xs/5 text-muted-foreground"
            data-testid="home-workflow-count"
          >
            {{ workflows.length }}
          </span>
        </div>

        <div
          v-if="state === 'loading'"
          :class="CARD_GRID_CLASS"
          aria-busy="true"
          data-testid="home-workflows-loading"
        >
          <Skeleton v-for="n in SKELETON_CARD_COUNT" :key="n" :class="CARD_SHAPE_CLASS" />
        </div>

        <ul v-else-if="state === 'ready'" class="m-0 list-none p-0" :class="CARD_GRID_CLASS">
          <li v-for="workflow in workflows" :key="workflow.id">
            <button
              type="button"
              class="group relative block cursor-pointer overflow-hidden border border-border bg-secondary p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :class="CARD_SHAPE_CLASS"
              :aria-label="t('home.openWorkflow', { title: workflow.title })"
              data-testid="home-workflow-card"
              @click="open(workflow)"
            >
              <img
                v-if="showsThumbnail(workflow)"
                :src="workflow.thumbnailUrl ?? undefined"
                alt=""
                loading="lazy"
                class="absolute inset-0 size-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
                @error="markThumbnailBroken(workflow)"
              />
              <span
                v-else
                class="absolute inset-0 flex items-center justify-center text-subtle-foreground"
              >
                <ImageOff :size="22" aria-hidden="true" />
              </span>
              <span
                class="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-linear-to-t from-black/85 via-black/55 to-transparent px-3 pt-10 pb-3"
              >
                <span class="flex items-start justify-between gap-2">
                  <span class="line-clamp-2 text-[13px]/[1.35] font-semibold text-white">
                    {{ workflow.title }}
                  </span>
                  <ArrowUpRight
                    :size="14"
                    aria-hidden="true"
                    class="mt-0.5 shrink-0 text-white/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  />
                </span>
                <span v-if="workflow.description" class="line-clamp-2 text-xs/[1.4] text-white/70">
                  {{ workflow.description }}
                </span>
              </span>
            </button>
          </li>
        </ul>

        <div
          v-else
          class="flex flex-col items-start gap-3 rounded-xl border border-border bg-secondary px-5 py-6"
          data-testid="home-workflows-unavailable"
        >
          <p class="m-0 text-[13px]/5 text-muted-foreground">
            {{ t('home.workflowsUnavailable') }}
          </p>
          <Button type="button" variant="secondary" size="md" @click="load">
            {{ t('home.retry') }}
          </Button>
        </div>
      </section>
    </div>
  </div>
</template>
