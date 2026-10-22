<script setup lang="ts">
import { computed, ref } from 'vue'
import { Cloud, Download, FolderInput, Images, Laptop, Trash2, X } from 'lucide-vue-next'
import Button from '../ui/Button.vue'
import EmptyState from '../ui/EmptyState.vue'
import PageHeader from '../ui/PageHeader.vue'
import SearchInput from '../ui/SearchInput.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import Select from '../ui/Select.vue'
import FolderFilterMenu from '../parts/FolderFilterMenu.vue'
import AssetTile from '../parts/AssetTile.vue'
import CloudSignInCta from '../parts/CloudSignInCta.vue'
import { allAssets, localFolders, type AssetSource } from '../gallery'
import { hostActions, proto, toast } from '../useProto'
import { PROJECTS, type Modality, type ProtoInstance } from '../mock'

/**
 * One gallery for every asset. A single filter row: where (All / This
 * computer / Cloud) is the primary scope; type, project and sort are quiet
 * selects; local folders live behind one Folders menu.
 */
const { scope, embedded = false } = defineProps<{
  /** Only what this environment produced. */
  scope?: ProtoInstance
  /** Inside another page (environment tabs): no page header or padding. */
  embedded?: boolean
}>()
const scoped = computed(() => allAssets.value.filter((a) => !scope || a.envId === scope.id))

const source = ref<'all' | AssetSource>('all')
const type = ref<'all' | Modality>('all')
const project = ref('all')
const sort = ref<'newest' | 'oldest' | 'name' | 'size'>('newest')
const q = ref('')
const hidden = ref(new Set<string>())
const selected = ref(new Set<string>())

const count = (s: AssetSource): number => allAssets.value.filter((a) => a.source === s).length
const sources = computed(() => [
  { value: 'all' as const, label: 'All', count: allAssets.value.length },
  { value: 'local' as const, label: 'This computer', icon: Laptop, count: count('local') },
  {
    value: 'cloud' as const,
    label: 'Cloud',
    icon: Cloud,
    count: proto.signedIn ? count('cloud') : undefined
  }
])
const types = [
  { value: 'all' as const, label: 'All types' },
  { value: 'image' as const, label: 'Images' },
  { value: 'video' as const, label: 'Videos' },
  { value: '3d' as const, label: '3D' },
  { value: 'audio' as const, label: 'Audio' }
]
const projects = [
  { value: 'all', label: 'All projects' },
  ...PROJECTS.map((p) => ({ value: p.name, label: p.name })),
  { value: 'none', label: 'No project' }
]
const sorts = [
  { value: 'newest' as const, label: 'Newest' },
  { value: 'oldest' as const, label: 'Oldest' },
  { value: 'name' as const, label: 'Name' },
  { value: 'size' as const, label: 'Largest' }
]

const list = computed(() => {
  const term = q.value.trim().toLowerCase()
  const out = scoped.value
    .filter((a) => source.value === 'all' || a.source === source.value)
    .filter((a) => type.value === 'all' || a.type === type.value)
    .filter((a) =>
      project.value === 'all'
        ? true
        : project.value === 'none'
          ? !a.project
          : a.project === project.value
    )
    .filter((a) => !a.folderId || !hidden.value.has(a.folderId))
    .filter((a) => !term || a.name.toLowerCase().includes(term))
  const by = {
    newest: (x: (typeof out)[number], y: (typeof out)[number]) => x.age - y.age,
    oldest: (x: (typeof out)[number], y: (typeof out)[number]) => y.age - x.age,
    name: (x: (typeof out)[number], y: (typeof out)[number]) => x.name.localeCompare(y.name),
    size: (x: (typeof out)[number], y: (typeof out)[number]) => y.sizeMb - x.sizeMb
  }[sort.value]
  return [...out].sort(by)
})

const filtered = computed(
  () =>
    type.value !== 'all' ||
    project.value !== 'all' ||
    hidden.value.size > 0 ||
    q.value.trim() !== ''
)
function reset(): void {
  type.value = 'all'
  project.value = 'all'
  hidden.value = new Set()
  q.value = ''
}
function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
function bulk(action: string): void {
  toast(`${action} ${selected.value.size} ${selected.value.size === 1 ? 'asset' : 'assets'}`)
  selected.value = new Set()
}
function addFolder(path: string): void {
  const name = path.split('/').pop() || path
  proto.extraAssetFolders.push({
    id: `custom-${Date.now()}`,
    name,
    path,
    custom: true,
    files: [
      {
        name: 'moodboard_01.jpg',
        size: '3.4 MB',
        modified: 'Last month',
        kind: 'image',
        thumbId: 'image_krea2_turbo_t2i'
      },
      {
        name: 'moodboard_02.jpg',
        size: '2.9 MB',
        modified: 'Last month',
        kind: 'image',
        thumbId: 'image_flux2'
      }
    ]
  })
  toast(`Added ${name}`)
}
</script>

<template>
  <div :class="embedded ? 'mt-3' : 'mx-auto w-full max-w-300 px-10 pb-16'">
    <PageHeader
      v-if="!embedded"
      title="Assets"
      :description="
        scope
          ? `Inputs and outputs of ${scope.name}.`
          : 'Everything you\'ve made, on this computer and on Comfy Cloud.'
      "
    />

    <!-- One row. Selection swaps the filters for bulk actions in place. -->
    <div class="flex h-12 items-center gap-2">
      <template v-if="!selected.size">
        <SegmentedControl v-if="!scope" v-model="source" variant="contained" :options="sources" />
        <span v-if="!scope" class="mx-1 h-5 w-px bg-border-default" />
        <Select v-model="type" :options="types" class="w-31" />
        <Select
          v-if="proto.signedIn && proto.projects && !scope"
          v-model="project"
          :options="projects"
          class="w-40"
        />
        <FolderFilterMenu
          v-if="source !== 'cloud' && (!scope || scope.kind === 'local')"
          v-model:hidden="hidden"
          :folders="localFolders"
          label="Show assets from"
          suggestion="/Users/pablo/Pictures/Comfy exports"
          @add="addFolder"
        />
        <Button v-if="filtered" variant="link" size="sm" class="ml-1" @click="reset">Reset</Button>
        <div class="ml-auto flex items-center gap-2">
          <SearchInput v-model="q" placeholder="Search assets" class="w-52" />
          <Select v-model="sort" label="Sort" :options="sorts" class="w-35" />
        </div>
      </template>
      <template v-else>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear selection"
          @click="selected = new Set()"
          ><X :size="14"
        /></Button>
        <span class="text-ui font-medium">{{ selected.size }} selected</span>
        <Button
          variant="link"
          size="sm"
          class="ml-2"
          @click="selected = new Set(list.map((a) => a.id))"
          >Select all</Button
        >
        <div class="ml-auto flex items-center gap-1">
          <Button variant="ghost" @click="bulk('Downloading')"
            ><Download :size="14" />Download</Button
          >
          <Button v-if="proto.projects && proto.signedIn" variant="ghost" @click="bulk('Moved')"
            ><FolderInput :size="14" />Move to project</Button
          >
          <Button variant="ghost" @click="bulk('Deleted')"><Trash2 :size="14" />Delete</Button>
        </div>
      </template>
    </div>

    <CloudSignInCta
      v-if="(source === 'cloud' || scope?.kind === 'cloud') && !proto.signedIn"
      title="Your Comfy Cloud assets live here"
      body="Log in to browse, search and organise everything you generate on Comfy Cloud."
    />
    <template v-else>
      <p
        v-if="!proto.signedIn && !scope"
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
        class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3.5"
      >
        <AssetTile
          v-for="a in list"
          :key="a.id"
          :asset="a"
          :selected="selected.has(a.id)"
          :selecting="selected.size > 0"
          @toggle="toggle(a.id)"
          @open="toast(`Open ${a.name}`)"
        />
      </div>
      <EmptyState
        v-else
        :icon="Images"
        title="Nothing here"
        description="No assets match these filters."
        class="mt-4"
      >
        <Button v-if="filtered" @click="reset">Reset filters</Button>
      </EmptyState>
    </template>
  </div>
</template>
