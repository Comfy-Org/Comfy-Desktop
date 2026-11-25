<script setup lang="ts">
import { computed, ref } from 'vue'
import { Cloud, Laptop, Workflow } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import EmptyState from '../../ui/EmptyState.vue'
import SearchInput from '../../ui/SearchInput.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import Select from '../../ui/Select.vue'
import CloudSignInCta from '../../parts/CloudSignInCta.vue'
import FolderFilterMenu from '../../parts/FolderFilterMenu.vue'
import WorkflowCard from '../../parts/WorkflowCard.vue'
import { allWorkflows, workflowFolders, type AssetSource } from '../../gallery'
import { hostActions, instances, proto, toast } from '../../useProto'
import { PROJECTS, type ProtoInstance } from '../../mock'

/**
 * Project workflows as cards. Same single filter row as Assets: where
 * (All / This computer / Cloud), then environment, type and local folders;
 * search and sort on the right.
 */
const { projectName, scope } = defineProps<{
  projectName?: string
  /** Environment-scoped IA: only this environment's workflows. */
  scope?: ProtoInstance
}>()

const source = ref<'all' | AssetSource>('all')
const env = ref('all')
const type = ref<'all' | 'image' | 'video'>('all')
const sort = ref<'modified' | 'name'>('modified')
const q = ref('')
const hidden = ref(new Set<string>())

const inProject = computed(() =>
  allWorkflows.value
    .filter((w) => !projectName || w.project === projectName)
    .filter((w) => !scope || w.envId === scope.id)
)
const count = (s: AssetSource): number => inProject.value.filter((w) => w.source === s).length
const sources = computed(() => [
  { value: 'all' as const, label: 'All', count: inProject.value.length },
  { value: 'local' as const, label: 'This computer', icon: Laptop, count: count('local') },
  {
    value: 'cloud' as const,
    label: 'Cloud',
    icon: Cloud,
    count: proto.signedIn ? count('cloud') : undefined
  }
])
const envs = computed(() => [
  { value: 'all', label: 'All builds' },
  ...instances.value
    .filter(
      (i) =>
        source.value === 'all' ||
        (source.value === 'local' ? i.kind === 'local' : i.kind === 'cloud')
    )
    .filter((i) => i.kind === 'local' || proto.signedIn)
    .map((i) => ({ value: i.id, label: i.name }))
])
const project = ref('all')
const projects = computed(() => [
  { value: 'all', label: 'All projects' },
  ...PROJECTS.map((p) => ({ value: p.name, label: p.name }))
])

const list = computed(() => {
  const term = q.value.trim().toLowerCase()
  const out = inProject.value
    .filter((w) => source.value === 'all' || w.source === source.value)
    .filter((w) => env.value === 'all' || w.envId === env.value)
    .filter((w) => project.value === 'all' || w.project === project.value)
    .filter((w) => type.value === 'all' || w.category === type.value)
    .filter((w) => !w.folderId || !hidden.value.has(w.folderId))
    .filter((w) => !term || w.name.toLowerCase().includes(term))
  return [...out].sort((a, b) =>
    sort.value === 'name' ? a.name.localeCompare(b.name) : a.age - b.age
  )
})
const filtered = computed(
  () =>
    env.value !== 'all' ||
    project.value !== 'all' ||
    type.value !== 'all' ||
    hidden.value.size > 0 ||
    q.value.trim() !== ''
)
function reset(): void {
  env.value = 'all'
  project.value = 'all'
  type.value = 'all'
  hidden.value = new Set()
  q.value = ''
}
function addFolder(path: string): void {
  const name = path.split('/').pop() || path
  proto.extraWorkflowFolders.push({
    id: `custom-${Date.now()}`,
    name,
    path,
    custom: true,
    files: [
      {
        name: 'team-upscaler.json',
        size: '27 KB',
        modified: 'Last month',
        kind: 'workflow',
        thumbId: 'utility_seedvr2_image_upscale~team-upscaler'
      }
    ]
  })
  toast(`Added ${name}`)
}
</script>

<template>
  <div class="mt-4 flex h-12 items-center gap-2">
    <SegmentedControl
      v-if="!scope"
      v-model="source"
      variant="contained"
      :options="sources"
      @update:model-value="env = 'all'"
    />
    <span v-if="!scope" class="mx-1 h-5 w-px bg-border-default" />
    <Select v-if="!scope" v-model="env" :options="envs" class="w-44" />
    <Select
      v-if="proto.projects && !projectName && proto.signedIn"
      v-model="project"
      :options="projects"
      class="w-44"
    />
    <Select
      v-model="type"
      class="w-31"
      :options="[
        { value: 'all', label: 'All types' },
        { value: 'image', label: 'Image' },
        { value: 'video', label: 'Video' }
      ]"
    />
    <FolderFilterMenu
      v-if="source !== 'cloud' && (!scope || scope.kind === 'local')"
      v-model:hidden="hidden"
      :folders="workflowFolders"
      label="Show workflows from"
      suggestion="/Users/pablo/Dropbox/Shared workflows"
      @add="addFolder"
    />
    <Button v-if="filtered" variant="link" size="sm" class="ml-1" @click="reset">Reset</Button>
    <div class="ml-auto flex items-center gap-2">
      <SearchInput v-model="q" placeholder="Search workflows" class="w-52" />
      <Select
        v-model="sort"
        label="Sort"
        class="w-40"
        :options="[
          { value: 'modified', label: 'Last edited' },
          { value: 'name', label: 'Name' }
        ]"
      />
    </div>
  </div>

  <CloudSignInCta
    v-if="(source === 'cloud' || scope?.kind === 'cloud') && !proto.signedIn"
    title="Save workflows to Comfy Cloud"
    :body="
      proto.projects
        ? 'Log in to keep workflows in sync across devices, group them into projects and share them with your team.'
        : 'Log in to keep workflows in sync across devices and share them with your team.'
    "
  />
  <template v-else>
    <p
      v-if="!proto.signedIn"
      class="mt-1 mb-1 flex items-center gap-1 text-ui text-subtle-foreground"
    >
      Showing this computer only.
      <Button
        variant="link"
        size="sm"
        class="text-base-foreground underline-offset-2 hover:underline"
        @click="hostActions.signIn()"
      >
        Log in to include Comfy Cloud
      </Button>
    </p>
    <div
      v-if="list.length"
      class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5"
    >
      <WorkflowCard v-for="w in list" :key="w.id" :wf="w" />
    </div>
    <EmptyState
      v-else
      :icon="Workflow"
      title="No workflows"
      description="Nothing matches these filters."
      class="mt-4"
    >
      <Button v-if="filtered" @click="reset">Reset filters</Button>
    </EmptyState>
  </template>
</template>
