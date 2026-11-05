<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Copy,
  Download,
  ExternalLink,
  FileUp,
  Link,
  Pencil,
  Plus,
  Star,
  Trash2
} from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Select from '../../ui/Select.vue'
import { ComfyWorkflow } from '../icons/comfyIcons'
import { thumb } from '../../mock'
import { go, hostActions, instanceById, toast } from '../../useProto'
import MarPage from './MarPage.vue'
import { EMPTY_PICS } from './emptyArt'
import MarItem from './MarItem.vue'
import WorkflowCover from '../brand/WorkflowCover.vue'
import { cover, isBranded } from '../cover'
import MarNewTile from './MarNewTile.vue'
import MarSeg from './MarSeg.vue'
import MarSearchField from './MarSearchField.vue'
import MarViewToggle from './MarViewToggle.vue'
import MarSelectBar from './MarSelectBar.vue'
import { useLibrary } from './library'
import { projectNames } from './projectsStore'
import { workflows, type MarWorkflow } from './workflowsStore'
import { notify } from './undo'
import { shownState } from './pageState'
import type { MenuLine } from './menu'

/**
 * Workflows (Mar's proposal): every workflow, on this computer and in
 * Comfy Cloud, as the product has them: where it lives, its type, its
 * project, sorted by last edit. Each card says if it's running, queued,
 * failed or unsaved. Everything in ⋯ works on the list in memory.
 */
const { project: fixedProject } = defineProps<{ project?: string }>()

type Where = 'all' | 'local' | 'cloud'
const where = ref<Where>('all')
const type = ref('all')
const project = ref('all')
const sort = ref('edited')
const query = ref('')
const view = ref<'grid' | 'list'>('grid')

const base = computed(() =>
  workflows.items.filter((w) => !fixedProject || w.project === fixedProject)
)
const WHERE = computed(() => [
  { value: 'all' as const, label: 'All', count: base.value.length },
  {
    value: 'local' as const,
    label: 'This computer',
    count: base.value.filter((w) => w.source === 'local').length
  },
  {
    value: 'cloud' as const,
    label: 'Cloud',
    count: base.value.filter((w) => w.source === 'cloud').length
  }
])
const WHERE_SELECT = computed(() =>
  WHERE.value.map((o) => ({ value: o.value, label: o.value === 'all' ? 'Everywhere' : o.label }))
)
const TYPES = [
  { value: 'all', label: 'All types' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' }
]
const PROJECTS = computed(() => [
  { value: 'all', label: 'All projects' },
  ...projectNames().map((n) => ({ value: n, label: n })),
  { value: 'none', label: 'No project' }
])
const SORTS = [
  { value: 'edited', label: 'Last edited' },
  { value: 'name', label: 'Name' }
]

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = base.value.filter(
    (w) =>
      (where.value === 'all' || w.source === where.value) &&
      (type.value === 'all' || w.category === type.value) &&
      (project.value === 'all' ||
        (project.value === 'none' ? !w.project : w.project === project.value)) &&
      (!q || w.name.toLowerCase().includes(q))
  )
  return sort.value === 'name'
    ? [...list].sort((a, b) => a.name.localeCompare(b.name))
    : [...list].sort((a, b) => a.age - b.age)
})
const filtered = computed(
  () => where.value !== 'all' || type.value !== 'all' || project.value !== 'all' || !!query.value
)
function clear(): void {
  where.value = 'all'
  type.value = 'all'
  project.value = 'all'
  query.value = ''
}

const lib = useLibrary(workflows, shown)

function open(w: MarWorkflow): void {
  const env = w.envId ? instanceById(w.envId) : undefined
  if (env) hostActions.launch(env, w.name)
  else toast(`Opening ${w.name}`)
}
function newWorkflow(): void {
  const w: MarWorkflow = {
    id: `wf-new-${Date.now()}`,
    name: 'Untitled workflow',
    source: 'local',
    thumbId: '',
    category: 'image',
    project: fixedProject,
    modified: 'Just now',
    age: 0,
    envId: 'local-1',
    status: 'draft',
    statusLabel: 'Unsaved'
  }
  workflows.items.unshift(w)
  lib.renaming.value = w.id
  notify('New workflow', () => workflows.items.splice(workflows.items.indexOf(w), 1))
}

const where_ = (w: MarWorkflow): string =>
  [w.source === 'cloud' ? 'Cloud' : 'This computer', !fixedProject && w.project, w.modified]
    .filter(Boolean)
    .join(' · ')

function lines(w: MarWorkflow): MenuLine[] {
  return [
    { label: 'Open', icon: ExternalLink, run: () => open(w) },
    { label: 'Rename', icon: Pencil, hint: 'F2', run: () => (lib.renaming.value = w.id) },
    { label: 'Duplicate', icon: Copy, hint: '⌘D', run: () => workflows.duplicate(w.id) },
    lib.moveLine(() => [w.id], w.project),
    {
      label: w.fav ? 'Remove from favorites' : 'Add to favorites',
      icon: Star,
      run: () => workflows.star(w.id)
    },
    'sep',
    { label: 'Export', icon: Download, run: () => toast(`Exported ${w.name}.json`) },
    ...(w.source === 'cloud'
      ? [{ label: 'Copy link', icon: Link, run: () => toast('Link copied') }]
      : []),
    'sep',
    { label: 'Delete', icon: Trash2, danger: true, hint: '⌫', run: () => workflows.remove([w.id]) }
  ]
}
</script>

<template>
  <MarPage
    title="Workflows"
    :embedded="!!fixedProject"
    :toolbar-to="fixedProject ? '#mar-proj-tools' : undefined"
    :skeleton="view === 'grid' ? 'grid' : 'list'"
    :no-results="shown.length === 0 && filtered"
    :state="shownState === 'live' && base.length === 0 ? 'empty' : undefined"
    :empty="{
      icon: ComfyWorkflow,
      title: fixedProject ? 'No workflows in this project yet' : 'Your workflows will live here',
      text: fixedProject
        ? 'Start one here, or move one in from Workflows with Move to project.'
        : 'Every workflow you save, on this computer and in Comfy Cloud. Start from a template; it lands here the first time you save it.',
      pics: EMPTY_PICS.workflows,
      action: fixedProject ? 'New workflow' : 'Browse templates',
      second: fixedProject ? undefined : 'Blank workflow'
    }"
    error-text="Cloud workflows are out of reach. The ones on this computer still open from their build."
    @action="fixedProject ? newWorkflow() : go('explore')"
    @second="newWorkflow"
    @clear="clear"
  >
    <template #actions="{ state }">
      <template v-if="state === 'live' || state === 'loading'">
        <Button variant="ghost" @click="toast('Pick a workflow file to import')"
          ><FileUp :size="15" />Import</Button
        >
        <Button variant="primary" @click="newWorkflow"><Plus :size="15" />Workflow</Button>
      </template>
    </template>

    <template #toolbar>
      <MarSeg v-if="!fixedProject" v-model="where" :options="WHERE" label="Where" />
      <div class="ml-auto flex items-center gap-2">
        <Select v-if="fixedProject" v-model="where" :options="WHERE_SELECT" class="w-36" />
        <Select v-model="type" :options="TYPES" class="w-32" />
        <Select v-if="!fixedProject" v-model="project" :options="PROJECTS" class="w-40" />
        <Select v-model="sort" :options="SORTS" label="Sort" class="w-40" />
        <MarSearchField v-model="query" placeholder="Search workflows" />
        <MarViewToggle v-model="view" />
      </div>
    </template>

    <div v-if="view === 'grid'" class="mar-grid">
      <MarItem
        v-for="w in shown"
        :key="w.id"
        :name="w.name"
        :thumb="w.thumbId ? thumb(w.thumbId) : undefined"
        :icon="ComfyWorkflow"
        :meta="where_(w)"
        :status="w.status"
        :status-label="w.statusLabel"
        :fav="w.fav"
        :lines="lines(w)"
        :selected="lib.sel.has(w.id)"
        :selecting="lib.sel.ids.value.size > 0"
        :renaming="lib.renaming.value === w.id"
        @open="open(w)"
        @select="lib.pick(w.id, $event)"
        @start-rename="lib.renaming.value = w.id"
        @rename="lib.rename(w.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
        @star="workflows.star(w.id)"
      >
        <template v-if="isBranded(cover.id)" #media>
          <WorkflowCover :name="w.name" />
        </template>
      </MarItem>
      <!-- A project's grid ends on the way to add more. -->
      <MarNewTile
        v-if="fixedProject && !filtered"
        label="New workflow"
        alt-label="Import a file"
        :alt-icon="FileUp"
        @create="newWorkflow"
        @alt="toast('Pick a workflow file to import')"
      />
    </div>
    <div v-else class="mar-table is-items" style="--mar-cols: minmax(0, 200px) 120px">
      <div class="mar-table-head">
        <span>Name</span><span>Project</span><span>Edited</span><span class="is-end">State</span
        ><span />
      </div>
      <MarItem
        v-for="w in shown"
        :key="w.id"
        layout="list"
        :name="w.name"
        :thumb="w.thumbId ? thumb(w.thumbId) : undefined"
        :icon="ComfyWorkflow"
        :meta="w.source === 'cloud' ? 'Cloud' : 'This computer'"
        :status="w.status"
        :status-label="w.statusLabel"
        :fav="w.fav"
        :lines="lines(w)"
        :selected="lib.sel.has(w.id)"
        :selecting="lib.sel.ids.value.size > 0"
        :renaming="lib.renaming.value === w.id"
        @open="open(w)"
        @select="lib.pick(w.id, $event)"
        @start-rename="lib.renaming.value = w.id"
        @rename="lib.rename(w.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
        @star="workflows.star(w.id)"
      >
        <template #cols>
          <span class="mar-item-col">{{ w.project ?? '—' }}</span>
          <span class="mar-item-col">{{ w.modified }}</span>
        </template>
      </MarItem>
    </div>

    <MarSelectBar
      :n="lib.sel.ids.value.size"
      noun="workflow"
      :actions="[
        lib.moveLine(() => lib.selected.value),
        {
          label: 'Export',
          icon: Download,
          run: () => (toast(`Exported ${lib.selected.value.length} workflows`), lib.sel.clear())
        },
        { label: 'Delete', icon: Trash2, danger: true, run: lib.removeSelected }
      ]"
      @clear="lib.sel.clear()"
      @all="lib.sel.all(lib.order.value)"
    />
  </MarPage>
</template>
