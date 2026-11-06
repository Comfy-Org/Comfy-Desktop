<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Copy,
  ExternalLink,
  EyeOff,
  Link2,
  LogOut,
  Pencil,
  Plus,
  Rocket,
  Sparkles,
  Trash2,
  UserPlus
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../../ui/Button.vue'
import Select from '../../ui/Select.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import { GraphIcon } from '../icons/kindIcons'
import { APPS, thumb } from '../../mock'
import { goIn, toast } from '../../useProto'
import { can } from '../../milestones'
import {
  accessLabel,
  LIB,
  addedApps,
  isAdded,
  openApp,
  openAppUrl,
  toggleAdded,
  resetFlow,
  SOURCES,
  startFrom,
  type LibApp
} from '../../appFlow'
import MarPage from './MarPage.vue'
import { EMPTY_PICS } from './emptyArt'
import MarItem from './MarItem.vue'
import MarSeg from './MarSeg.vue'
import MarSearchField from './MarSearchField.vue'
import MarViewToggle from './MarViewToggle.vue'
import MarSelectBar from './MarSelectBar.vue'
import { collection } from './collection'
import { useLibrary } from './library'
import { shownState } from './pageState'
import { notify } from './undo'
import type { MenuLine } from './menu'
import type { ItemStatus } from './MarStatus.vue'

/**
 * Apps (Mar's proposal): tools anyone can run from a link, the ones you
 * made and the ones shared with you, as Pablo's library has them. Each
 * card says if it's live, a draft, or live with changes not yet
 * published, and who can use it. Works on the apps in memory, so a
 * rename shows on the app's own page too.
 */
const apps = collection<LibApp & { project?: string; fav?: boolean }>(LIB, 'app')

const tab = ref<'mine' | 'shared'>('mine')
const state = ref('all')
const sort = ref('updated')
const query = ref('')
const view = ref<'grid' | 'list'>('grid')

const mine = (a: LibApp): boolean => a.group === 'yours'
// Apps added from Explore sit in My apps, but you stay their user.
const inMine = (a: LibApp): boolean => mine(a) || isAdded(a.id)
const all = computed<LibApp[]>(() => [...LIB, ...addedApps.value])
const TABS = computed(() => [
  { value: 'mine' as const, label: 'My apps', count: all.value.filter(inMine).length },
  {
    value: 'shared' as const,
    label: 'Shared with me',
    count: all.value.filter((a) => !inMine(a)).length
  }
])
const openIt = (a: LibApp): void => (isAdded(a.id) ? openAppUrl(a.id) : openApp(a.id))
const STATES = [
  { value: 'all', label: 'Any state' },
  { value: 'live', label: 'Live' },
  { value: 'draft', label: 'Draft' },
  { value: 'changes', label: 'Unpublished changes' }
]
const SORTS = [
  { value: 'updated', label: 'Last updated' },
  { value: 'runs', label: 'Most runs' },
  { value: 'name', label: 'Name' }
]

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = all.value.filter(
    (a) =>
      (tab.value === 'mine' ? inMine(a) : !inMine(a)) &&
      (state.value === 'all' ||
        (state.value === 'changes'
          ? a.unpublished && a.state === 'live'
          : a.state === state.value)) &&
      (!q || `${a.name} ${a.owner} ${a.blurb}`.toLowerCase().includes(q))
  )
  if (sort.value === 'runs') return [...list].sort((a, b) => b.runs - a.runs)
  if (sort.value === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name))
  return list
})
const filtered = computed(() => state.value !== 'all' || !!query.value)
const tabEmpty = computed(() => shown.value.length === 0 && !filtered.value)
function clear(): void {
  state.value = 'all'
  query.value = ''
}

const lib = useLibrary(apps, shown)

function status(a: LibApp): ItemStatus {
  if (isAdded(a.id)) return 'live'
  if (!mine(a)) return 'shared'
  if (a.state === 'draft') return 'draft'
  return a.unpublished ? 'changes' : 'live'
}
const meta = (a: LibApp): string =>
  mine(a)
    ? `${accessLabel(a)} · ${a.runs.toLocaleString('en-US')} runs`
    : `${a.owner} · ${a.runs.toLocaleString('en-US')} runs`
const favId = (a: LibApp): string | undefined => APPS.find((x) => x.name === a.name)?.id

function describe(): void {
  resetFlow()
  goIn('agent', 'agent')
}
function publish(a: LibApp): void {
  const before = { state: a.state, unpublished: a.unpublished }
  a.state = 'live'
  a.unpublished = false
  notify(`“${a.name}” is live`, () => Object.assign(a, before))
}
function unpublish(a: LibApp): void {
  a.state = 'draft'
  notify(`“${a.name}” is a draft again. Its link stops working.`, () => (a.state = 'live'))
}

function lines(a: LibApp): MenuLine[] {
  if (isAdded(a.id))
    return [
      { label: 'Open', icon: ExternalLink, run: () => openAppUrl(a.id) },
      'sep',
      { label: 'Remove from my apps', icon: LogOut, danger: true, run: () => toggleAdded(a) }
    ]
  if (!mine(a))
    return [
      { label: 'Open', icon: ExternalLink, run: () => openApp(a.id) },
      { label: 'Copy link', icon: Link2, run: () => toast('Link copied') },
      { label: 'Duplicate to my apps', icon: Copy, run: () => apps.duplicate(a.id) },
      'sep',
      { label: 'Remove from my list', icon: LogOut, danger: true, run: () => apps.remove([a.id]) }
    ]
  return [
    { label: 'Open', icon: ExternalLink, run: () => openApp(a.id) },
    { label: 'Rename', icon: Pencil, run: () => (lib.renaming.value = a.id) },
    { label: 'Share…', icon: UserPlus, run: () => openApp(a.id) },
    ...(a.state === 'live'
      ? [{ label: 'Copy link', icon: Link2, run: () => toast(`Copied ${a.slug}.comfy.app`) }]
      : []),
    { label: 'Duplicate', icon: Copy, run: () => apps.duplicate(a.id) },
    'sep',
    a.state === 'draft' || a.unpublished
      ? {
          label: a.state === 'draft' ? 'Publish' : 'Publish changes',
          icon: Rocket,
          run: () => publish(a)
        }
      : { label: 'Unpublish', icon: EyeOff, run: () => unpublish(a) },
    'sep',
    { label: 'Delete', icon: Trash2, danger: true, run: () => apps.remove([a.id]) }
  ]
}
</script>

<template>
  <MarPage
    title="Apps"
    :skeleton="view === 'grid' ? 'grid' : 'list'"
    :no-results="shown.length === 0 && filtered"
    :state="shownState === 'live' && all.length === 0 ? 'empty' : undefined"
    :empty="{
      icon: Sparkles,
      title: 'Turn a workflow into an app',
      text: 'Pick the few inputs that matter, name it, share a link. People run it without seeing a node.',
      pics: EMPTY_PICS.apps,
      action: 'Make your first app',
      second: can.agent ? 'Describe it to Comfy Agent' : undefined
    }"
    error-text="Apps run on Comfy Cloud, which is out of reach right now. Your workflows on this computer still work."
    @action="startFrom(SOURCES[0]!)"
    @second="describe"
    @clear="clear"
  >
    <template #actions="{ state: s }">
      <!-- Making apps is the Agent's (Milestone 10). -->
      <DropdownMenuRoot v-if="can.agent && (s === 'live' || s === 'loading')" :modal="false">
        <DropdownMenuTrigger as-child>
          <Button variant="primary"><Plus :size="15" />App</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-64">
          <DropdownMenuItem @select="describe"
            ><Sparkles :size="14" />Describe it to Comfy Agent</DropdownMenuItem
          >
          <DropdownMenuSeparator />
          <DropdownMenuLabel>From a workflow</DropdownMenuLabel>
          <DropdownMenuItem v-for="s2 in SOURCES" :key="s2.name" @select="startFrom(s2)"
            ><GraphIcon :size="14" />{{ s2.name }}</DropdownMenuItem
          >
        </DropdownMenuContent>
      </DropdownMenuRoot>
    </template>

    <template #toolbar>
      <MarSeg v-model="tab" :options="TABS" label="Whose" />
      <div class="ml-auto flex items-center gap-2">
        <Select v-if="tab === 'mine'" v-model="state" :options="STATES" class="w-44" />
        <Select v-model="sort" :options="SORTS" label="Sort" class="w-44" />
        <MarSearchField v-model="query" placeholder="Search apps" />
        <MarViewToggle v-model="view" />
      </div>
    </template>

    <!-- A tab with nothing in it yet says what will land there. -->
    <p v-if="tabEmpty" class="mar-apps-none">
      {{
        tab === 'mine'
          ? can.agent
            ? 'You haven’t made an app yet. Start one from a workflow with + App.'
            : 'Nothing here yet. Add apps from Explore and they show up here.'
          : 'Nobody has shared an app with you yet. When they do, it shows up here.'
      }}
    </p>
    <div v-else-if="view === 'grid'" class="mar-grid">
      <MarItem
        v-for="a in shown"
        :key="a.id"
        :name="a.name"
        :thumb="thumb(a.thumbId)"
        :meta="meta(a)"
        :status="status(a)"
        :fav-id="favId(a)"
        fav-kind="app"
        :lines="lines(a)"
        :selected="lib.sel.has(a.id)"
        :selecting="lib.sel.ids.value.size > 0"
        :renaming="lib.renaming.value === a.id"
        @open="openIt(a)"
        @select="lib.pick(a.id, $event)"
        @start-rename="mine(a) && (lib.renaming.value = a.id)"
        @rename="lib.rename(a.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
      />
    </div>
    <div
      v-else
      class="mar-table is-items"
      style="--mar-cols: minmax(0, 200px) 88px; --mar-state: 168px"
    >
      <div class="mar-table-head">
        <span>App</span><span>{{ tab === 'mine' ? 'Who can use it' : 'From' }}</span
        ><span class="is-num">Runs</span><span class="is-end">State</span><span />
      </div>
      <MarItem
        v-for="a in shown"
        :key="a.id"
        layout="list"
        :name="a.name"
        :thumb="thumb(a.thumbId)"
        :meta="a.blurb"
        :status="status(a)"
        :fav-id="favId(a)"
        fav-kind="app"
        :lines="lines(a)"
        :selected="lib.sel.has(a.id)"
        :selecting="lib.sel.ids.value.size > 0"
        :renaming="lib.renaming.value === a.id"
        @open="openIt(a)"
        @select="lib.pick(a.id, $event)"
        @start-rename="mine(a) && (lib.renaming.value = a.id)"
        @rename="lib.rename(a.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
      >
        <template #cols>
          <span class="mar-item-col">{{ mine(a) ? accessLabel(a) : a.owner }}</span>
          <span class="mar-item-col is-num">{{ a.runs.toLocaleString('en-US') }}</span>
        </template>
      </MarItem>
    </div>

    <MarSelectBar
      :n="lib.sel.ids.value.size"
      noun="app"
      :actions="[
        { label: 'Copy links', icon: Link2, run: () => (toast('Links copied'), lib.sel.clear()) },
        { label: 'Delete', icon: Trash2, danger: true, run: lib.removeSelected }
      ]"
      @clear="lib.sel.clear()"
      @all="lib.sel.all(lib.order.value)"
    />
  </MarPage>
</template>

<style scoped>
.mar-apps-none {
  padding: 56px 0;
  color: var(--color-subtle-foreground);
  font-size: 13px;
  text-align: center;
}
</style>
