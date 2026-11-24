<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Cloud, Laptop, LoaderCircle } from '@lucide/vue'
import WorkflowCover from './WorkflowCover.vue'
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

const shown = computed(() => all.value.filter((w) => buildIds.has(w.installationId)))

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
    <div class="mb-2.5 flex h-6 items-center">
      <h2 id="home-recent-workflows" class="m-0" :class="SECTION_TITLE_CLASS">
        {{ t('home.recentWorkflows') }}
      </h2>
    </div>
    <ul
      class="m-0 grid list-none grid-cols-4 gap-[15px] p-0 @max-[56rem]/home-recents:grid-cols-3 @max-[40rem]/home-recents:grid-cols-2"
    >
      <li v-for="workflow in shown" :key="workflow.id" class="min-w-0">
        <button
          type="button"
          class="group flex w-full flex-col rounded-2xl bg-card p-1.5 text-left outline-none transition-colors hover:bg-(--build-card-hover) focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
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
