<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Archive,
  ArchiveRestore,
  Copy,
  ExternalLink,
  FolderKanban,
  Pencil,
  Plus,
  Server,
  Trash2,
  UserPlus
} from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Select from '../../ui/Select.vue'
import MemberAvatar from '../../parts/MemberAvatar.vue'
import { go, instances, toast, type Page } from '../../useProto'
import MarPage from './MarPage.vue'
import { EMPTY_PICS } from './emptyArt'
import MarItem from './MarItem.vue'
import MarSeg from './MarSeg.vue'
import MarSearchField from './MarSearchField.vue'
import MarViewToggle from './MarViewToggle.vue'
import MarSelectBar from './MarSelectBar.vue'
import { useLibrary } from './library'
import { shownState } from './pageState'
import { newProject, projects, type MarProject } from './projectsStore'
import { workflows } from './workflowsStore'
import { assets } from './assetsStore'
import { count, notify } from './undo'
import type { MenuLine } from './menu'

/**
 * Projects (Mar's proposal): a shared place for a piece of work that
 * always runs on one build, as Pablo has them. Cards show the photo, the
 * build, who's in it and how much is inside. Archive keeps a project out
 * of the way without losing it; delete comes with Undo.
 */
const tab = ref<'active' | 'archived'>('active')
const sort = ref('updated')
const query = ref('')
const view = ref<'grid' | 'list'>('grid')

const TABS = computed(() => [
  {
    value: 'active' as const,
    label: 'Active',
    count: projects.items.filter((p) => !p.archived).length
  },
  {
    value: 'archived' as const,
    label: 'Archived',
    count: projects.items.filter((p) => p.archived).length
  }
])
const SORTS = [
  { value: 'updated', label: 'Last updated' },
  { value: 'name', label: 'Name' }
]
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = projects.items.filter(
    (p) => (tab.value === 'archived') === !!p.archived && (!q || p.name.toLowerCase().includes(q))
  )
  return sort.value === 'name' ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : list
})
const lib = useLibrary(projects, shown)

const buildName = (p: MarProject): string =>
  instances.value.find((i) => i.id === p.envId)?.name ?? 'No build'
const inside = (p: MarProject): string => {
  const w = workflows.items.filter((x) => x.project === p.name).length
  const a = assets.items.filter((x) => x.project === p.name).length
  return `${count(w, 'workflow')} · ${count(a, 'asset')}`
}

function open(p: MarProject): void {
  go(`project:${p.id}` as Page)
}
function create(): void {
  const p = newProject()
  tab.value = 'active'
  lib.renaming.value = p.id
  notify('New project. Name it, then add workflows.', () =>
    projects.items.splice(projects.items.indexOf(p), 1)
  )
}
function archive(ids: string[], on: boolean): void {
  const list = projects.items.filter((p) => ids.includes(p.id))
  for (const p of list) p.archived = on
  lib.sel.clear()
  notify(
    `${on ? 'Archived' : 'Restored'} ${list.length === 1 ? `“${list[0]!.name}”` : count(list.length, 'project')}`,
    () => list.forEach((p) => (p.archived = !on))
  )
}
function setBuild(p: MarProject, envId: string): void {
  const before = p.envId
  p.envId = envId
  notify(`${p.name} now runs on ${buildName(p)}`, () => (p.envId = before))
}

function lines(p: MarProject): MenuLine[] {
  return [
    { label: 'Open', icon: ExternalLink, run: () => open(p) },
    { label: 'Rename', icon: Pencil, run: () => (lib.renaming.value = p.id) },
    { label: 'Invite people', icon: UserPlus, run: () => toast(`Invite to ${p.name}`) },
    {
      label: 'Runs on',
      icon: Server,
      sub: instances.value.map((i) => ({
        label: i.name,
        checked: i.id === p.envId,
        run: () => setBuild(p, i.id)
      }))
    },
    { label: 'Duplicate', icon: Copy, run: () => projects.duplicate(p.id) },
    'sep',
    p.archived
      ? { label: 'Restore', icon: ArchiveRestore, run: () => archive([p.id], false) }
      : { label: 'Archive', icon: Archive, run: () => archive([p.id], true) },
    { label: 'Delete', icon: Trash2, danger: true, run: () => projects.remove([p.id]) }
  ]
}
</script>

<template>
  <MarPage
    title="Projects"
    :skeleton="view === 'grid' ? 'grid' : 'list'"
    :no-results="shown.length === 0 && !!query"
    :state="
      projects.items.length === 0
        ? shownState === 'live'
          ? 'empty'
          : undefined
        : shownState === 'empty'
          ? 'live'
          : undefined
    "
    :empty="{
      icon: FolderKanban,
      title: 'Keep a piece of work together',
      text: 'A project holds its workflows and assets, runs on one build, and can be shared with the people working on it.',
      pics: EMPTY_PICS.projects,
      action: 'New project'
    }"
    error-text="Shared projects are out of reach. Workflows on this computer still open from Workflows."
    @action="create"
    @clear="query = ''"
  >
    <template #actions="{ state }">
      <Button v-if="state === 'live' || state === 'loading'" variant="primary" @click="create"
        ><Plus :size="15" />Project</Button
      >
    </template>

    <template #toolbar>
      <MarSeg v-model="tab" :options="TABS" label="Projects" />
      <div class="ml-auto flex items-center gap-2">
        <Select v-model="sort" :options="SORTS" label="Sort" class="w-44" />
        <MarSearchField v-model="query" placeholder="Search projects" />
        <MarViewToggle v-model="view" />
      </div>
    </template>

    <p v-if="shown.length === 0 && !query" class="mar-proj-none">
      {{
        tab === 'archived'
          ? 'Nothing archived. Archive a project from its ⋯ to tidy up without losing it.'
          : 'Every project is archived.'
      }}
    </p>
    <div v-else-if="view === 'grid'" class="mar-grid is-wide">
      <MarItem
        v-for="p in shown"
        :key="p.id"
        :name="p.name"
        :thumb="p.art"
        :meta="`${buildName(p)} · ${inside(p)}`"
        :status="p.archived ? 'paused' : (p.status ?? (p.shared ? 'shared' : undefined))"
        :status-label="p.archived ? 'Archived' : p.status === 'running' ? '1 running' : undefined"
        :fav="p.fav"
        :lines="lines(p)"
        :selected="lib.sel.has(p.id)"
        :selecting="lib.sel.ids.value.size > 0"
        :renaming="lib.renaming.value === p.id"
        ratio="16 / 8"
        @open="open(p)"
        @select="lib.pick(p.id, $event)"
        @start-rename="lib.renaming.value = p.id"
        @rename="lib.rename(p.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
        @star="projects.star(p.id)"
      >
        <template #overlay>
          <span class="mar-proj-people">
            <MemberAvatar v-for="m in p.members.slice(0, 4)" :key="m" :name="m" size="sm" />
            <span v-if="p.members.length > 4" class="mar-proj-more"
              >+{{ p.members.length - 4 }}</span
            >
          </span>
        </template>
      </MarItem>
    </div>
    <div v-else class="mar-table is-items" style="--mar-cols: minmax(0, 200px) 104px 120px">
      <div class="mar-table-head">
        <span>Project</span><span>Runs on</span><span>People</span><span>Updated</span
        ><span class="is-end">State</span><span />
      </div>
      <MarItem
        v-for="p in shown"
        :key="p.id"
        layout="list"
        :name="p.name"
        :thumb="p.art"
        :meta="inside(p)"
        :status="p.archived ? 'paused' : (p.status ?? (p.shared ? 'shared' : undefined))"
        :status-label="p.archived ? 'Archived' : p.status === 'running' ? '1 running' : undefined"
        :fav="p.fav"
        :lines="lines(p)"
        :selected="lib.sel.has(p.id)"
        :selecting="lib.sel.ids.value.size > 0"
        :renaming="lib.renaming.value === p.id"
        @open="open(p)"
        @select="lib.pick(p.id, $event)"
        @start-rename="lib.renaming.value = p.id"
        @rename="lib.rename(p.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
        @star="projects.star(p.id)"
      >
        <template #cols>
          <span class="mar-item-col">{{ buildName(p) }}</span>
          <span class="mar-item-col">{{
            count(p.members.length, 'person').replace('persons', 'people')
          }}</span>
          <span class="mar-item-col">{{ p.updated }}</span>
        </template>
      </MarItem>
    </div>

    <MarSelectBar
      :n="lib.sel.ids.value.size"
      noun="project"
      :actions="[
        tab === 'archived'
          ? {
              label: 'Restore',
              icon: ArchiveRestore,
              run: () => archive(lib.selected.value, false)
            }
          : { label: 'Archive', icon: Archive, run: () => archive(lib.selected.value, true) },
        { label: 'Delete', icon: Trash2, danger: true, run: lib.removeSelected }
      ]"
      @clear="lib.sel.clear()"
      @all="lib.sel.all(lib.order.value)"
    />
  </MarPage>
</template>

<style>
.mar-proj-people {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: flex;
}
.mar-proj-people > * {
  margin-left: -6px;
  box-shadow: 0 0 0 2px rgb(0 0 0 / 0.45);
}
.mar-proj-more {
  display: inline-flex;
  height: 24px;
  align-items: center;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--color-media-overlay);
  color: rgb(255 255 255 / 0.9);
  font-size: 11px;
}
.mar-proj-none {
  padding: 56px 0;
  color: var(--color-subtle-foreground);
  font-size: 13px;
  text-align: center;
}
</style>
