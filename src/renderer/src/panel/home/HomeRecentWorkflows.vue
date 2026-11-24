<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, Cloud, Laptop, LoaderCircle } from '@lucide/vue'
import { useResizeObserver } from '@vueuse/core'
import Button from '@comfyorg/design-system/button/Button'
import Tooltip from '../../components/ui/Tooltip.vue'
import WorkflowCover from './WorkflowCover.vue'
import { HOME_BUILD_TONES } from './homeBuild'
import { useModal } from '../../composables/useModal'
import { formatRelativeFromMs } from '../../lib/datetime'
import { SECTION_TITLE_CLASS } from '../../lib/sectionTitle'
import type { RecentWorkflow } from '../../types/ipc'

const { buildIds } = defineProps<{ buildIds: ReadonlySet<string> }>()

const { t } = useI18n()
const modal = useModal()

const all = ref<RecentWorkflow[]>([])
const opening = ref<string | null>(null)
const now = ref(Date.now())

const ROW_LIMIT = 10
const EDGE_SLACK_PX = 2

const shown = computed(() =>
  all.value.filter((w) => buildIds.has(w.installationId)).slice(0, ROW_LIMIT)
)

const row = ref<HTMLElement | null>(null)
const atStart = ref(true)
const atEnd = ref(true)
const overflows = computed(() => !(atStart.value && atEnd.value))

function measure(): void {
  const el = row.value
  if (!el) return
  atStart.value = el.scrollLeft <= EDGE_SLACK_PX
  atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - EDGE_SLACK_PX
}

function page(direction: -1 | 1): void {
  row.value?.scrollBy({ left: direction * (row.value.clientWidth + 15), behavior: 'smooth' })
}

useResizeObserver(row, measure)
watch(shown, () => void nextTick(measure))

let latestLoad = 0

async function listInScope(): Promise<RecentWorkflow[]> {
  try {
    const listed: unknown = await window.api.listRecentWorkflows([...buildIds])
    return Array.isArray(listed) ? (listed as RecentWorkflow[]) : []
  } catch {
    return []
  }
}

async function load(): Promise<void> {
  const request = ++latestLoad
  const listed = await listInScope()
  if (request !== latestLoad) return
  all.value = listed
  now.value = Date.now()
}

function toneGlow(workflow: RecentWorkflow): string {
  const { tint } = HOME_BUILD_TONES[workflow.where === 'cloud' ? 'tide' : 'iris']
  return `radial-gradient(90% 120% at 0% 0%, rgb(${tint} / 0.38), rgb(${tint} / 0) 70%)`
}

function editedLabel(workflow: RecentWorkflow): string {
  return formatRelativeFromMs(workflow.modifiedAt, t, now.value)
}

async function open(workflow: RecentWorkflow): Promise<void> {
  if (opening.value !== null) return
  opening.value = workflow.id
  const result = await window.api
    .openRecentWorkflow(workflow.installationId, workflow.path)
    .catch(() => ({ opened: false, error: undefined }))
  opening.value = null
  if (result.opened) return
  await modal.alert({
    title: t('home.recentWorkflowOpenFailed'),
    message: result.error ?? t('assets.detail.openWorkflowNoReason')
  })
}

function onFocus(): void {
  void load()
}

watch(
  () => [...buildIds].sort().join('\n'),
  () => void load()
)

onMounted(() => {
  void load()
  window.addEventListener('focus', onFocus)
})
onBeforeUnmount(() => window.removeEventListener('focus', onFocus))
</script>

<template>
  <section
    v-if="shown.length > 0"
    class="@container/home-recents mt-[50px]"
    aria-labelledby="home-recent-workflows"
    data-testid="home-recent-workflows"
  >
    <div class="mb-2.5 flex h-6 items-center justify-between">
      <h2 id="home-recent-workflows" class="m-0" :class="SECTION_TITLE_CLASS">
        {{ t('home.recentWorkflows') }}
      </h2>
      <div v-if="overflows" class="flex shrink-0 gap-1" data-testid="home-recent-workflows-arrows">
        <Tooltip :text="t('home.previousWorkflows')">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            class="size-8 rounded-lg"
            :aria-label="t('home.previousWorkflows')"
            :disabled="atStart"
            data-testid="home-recent-workflows-previous"
            @click="page(-1)"
          >
            <ChevronLeft :size="16" aria-hidden="true" />
          </Button>
        </Tooltip>
        <Tooltip :text="t('home.nextWorkflows')">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            class="size-8 rounded-lg"
            :aria-label="t('home.nextWorkflows')"
            :disabled="atEnd"
            data-testid="home-recent-workflows-next"
            @click="page(1)"
          >
            <ChevronRight :size="16" aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>
    </div>
    <ul
      ref="row"
      class="m-0 flex list-none snap-x snap-mandatory gap-[15px] overflow-x-auto scroll-smooth p-0 [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
      data-testid="home-recent-workflows-row"
      @scroll.passive="measure"
    >
      <li
        v-for="workflow in shown"
        :key="workflow.id"
        class="min-w-0 shrink-0 basis-[calc((100%-45px)/4)] snap-start @max-[56rem]/home-recents:basis-[calc((100%-30px)/3)] @max-[40rem]/home-recents:basis-[calc((100%-15px)/2)]"
      >
        <button
          type="button"
          class="group relative flex w-full flex-col overflow-hidden rounded-2xl bg-card bg-[linear-gradient(180deg,var(--build-card-sheen),transparent_40%)] [box-shadow:var(--build-card-highlight)] p-1.5 text-left outline-none transition-colors hover:bg-(--build-card-hover) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default"
          :aria-label="
            t('home.openRecentWorkflow', { title: workflow.title, build: workflow.buildName })
          "
          :aria-busy="opening === workflow.id ? 'true' : undefined"
          :disabled="opening !== null"
          data-testid="home-recent-workflow"
          :data-workflow-path="workflow.path"
          @click="open(workflow)"
        >
          <span class="relative block aspect-[16/10] overflow-hidden rounded-xl">
            <WorkflowCover :name="workflow.title" />
            <span
              class="pointer-events-none absolute inset-0 origin-[0%_0%] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.8] motion-reduce:transition-none"
              :style="{ background: toneGlow(workflow) }"
              data-testid="home-recent-workflow-glow"
              aria-hidden="true"
            />
            <span
              v-if="opening === workflow.id"
              class="absolute inset-0 flex items-center justify-center bg-black/40"
            >
              <LoaderCircle
                :size="18"
                class="animate-spin text-foreground motion-reduce:animate-none"
                aria-hidden="true"
              />
            </span>
          </span>
          <span class="flex min-w-0 flex-col px-1.5 pt-2.5 pb-1">
            <span
              class="truncate text-[13px]/5 font-medium text-foreground"
              data-testid="home-recent-workflow-title"
              >{{ workflow.title }}</span
            >
            <span class="mt-0.5 flex items-center gap-1.5 text-xs/4 text-muted-foreground">
              <component
                :is="workflow.where === 'cloud' ? Cloud : Laptop"
                :size="12"
                class="shrink-0"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate">{{ workflow.buildName }}</span>
              <span class="shrink-0">{{ editedLabel(workflow) }}</span>
            </span>
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>
