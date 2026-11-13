<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LayoutGrid, Trash2, Upload } from 'lucide-vue-next'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import FilterButton from '../../components/ui/FilterButton.vue'
import type { PerformanceTestWorkflowSource } from '../../composables/usePerformanceTestWorkflow'

const props = defineProps<{
  label: string
  source: PerformanceTestWorkflowSource | null
  filePath: string | null
  locked: boolean
  importing: boolean
  deleting: boolean
  canChooseExample: boolean
  loadingExamples: boolean
  downloading: boolean
}>()

const emit = defineEmits<{
  'choose-example': []
  import: []
  'import-file': [file: File]
  remove: []
}>()

const { t } = useI18n()
const isDragging = ref(false)

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}

function enterDrag(event: DragEvent): void {
  isDragging.value = !props.locked && carriesFiles(event)
}

function leaveDrag(event: DragEvent): void {
  const zone = event.currentTarget as HTMLElement
  if (event.relatedTarget instanceof Node && zone.contains(event.relatedTarget)) return
  isDragging.value = false
}

function drop(event: DragEvent): void {
  isDragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file && !props.locked) emit('import-file', file)
}
</script>

<template>
  <section
    class="performance-test__step performance-test__drop-zone -m-1 flex min-w-0 rounded-[12px] p-1 outline-1 outline-offset-[-1px] transition-[outline-color,background-color] duration-[140ms] @max-[36rem]/setup:basis-[calc(100%+0.5rem)]"
    :class="
      isDragging
        ? 'performance-test__drop-zone--dragging bg-white/4 outline-white/35 outline-dashed'
        : 'outline-transparent'
    "
    :aria-busy="importing || deleting"
    @dragenter.prevent="enterDrag"
    @dragover.prevent="enterDrag"
    @dragleave.prevent="leaveDrag"
    @drop.prevent="drop"
  >
    <h2 class="sr-only">{{ t('performanceTest.chooseWorkflow') }}</h2>
    <Menu
      :modal="false"
      align="start"
      class="z-20 min-w-[260px]"
      :aria-label="t('performanceTest.chooseWorkflow')"
    >
      <template #trigger>
        <FilterButton
          class="performance-test__workflow-trigger max-w-[26rem] @max-[36rem]/setup:w-full @max-[36rem]/setup:max-w-none"
          :label="t('performanceTest.chooseWorkflow')"
          :placeholder="
            importing
              ? t('performanceTest.importingWorkflow')
              : t('performanceTest.chooseWorkflowPlaceholder')
          "
          :aria-label="
            source
              ? t('performanceTest.workflowTriggerLabel', { workflow: label })
              : t('performanceTest.chooseWorkflowPlaceholder')
          "
          :title="filePath ?? undefined"
          :disabled="locked"
        >
          <span
            v-if="source"
            class="performance-test__workflow-file flex min-w-0 items-center gap-1.5"
          >
            <span class="truncate">{{ label }}</span>
            <span
              class="performance-test__workflow-tag shrink-0 rounded-[5px] bg-white/8 px-1.5 text-[11px] leading-[1.45] text-text-muted"
            >
              {{
                source === 'example' ? t('performanceTest.exampleTag') : t('performanceTest.apiTag')
              }}
            </span>
          </span>
        </FilterButton>
      </template>
      <MenuItem
        as="button"
        type="button"
        class="performance-test__example-workflow w-full"
        :disabled="!canChooseExample || importing || loadingExamples"
        @select="emit('choose-example')"
      >
        <LayoutGrid :size="15" aria-hidden="true" />
        <span>{{
          loadingExamples
            ? t('performanceTest.loadingExampleWorkflows')
            : t('performanceTest.chooseExampleWorkflow')
        }}</span>
      </MenuItem>
      <MenuItem
        as="button"
        type="button"
        class="performance-test__import-workflow w-full"
        :disabled="importing"
        @select="emit('import')"
      >
        <Upload :size="15" aria-hidden="true" />
        <span>{{ t('performanceTest.importApiWorkflow') }}</span>
        <span class="ml-auto pl-4 text-[12px] text-text-muted">{{
          t('performanceTest.orDropJson')
        }}</span>
      </MenuItem>
      <template v-if="filePath">
        <MenuSeparator />
        <MenuItem
          as="button"
          type="button"
          class="performance-test__delete-workflow w-full text-danger"
          :disabled="deleting"
          @select="emit('remove')"
        >
          <Trash2 :size="15" aria-hidden="true" />
          <span>{{
            downloading
              ? t('performanceTest.cancelExampleDownload')
              : t('performanceTest.deleteWorkflow')
          }}</span>
        </MenuItem>
      </template>
    </Menu>
  </section>
</template>
