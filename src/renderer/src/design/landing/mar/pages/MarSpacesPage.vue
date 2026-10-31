<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Copy,
  Eye,
  ExternalLink,
  Globe2,
  Pause,
  Pencil,
  Play,
  Plus,
  Rocket,
  Trash2,
  UserPlus
} from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Select from '../../ui/Select.vue'
import SpaceMark from '../../parts/space/SpaceMark.vue'
import { SPACES, goLive, previewSpace, type Space } from '../../spaces'
import { go, proto, toast, type Page } from '../../useProto'
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
import { count, notify } from './undo'
import type { MenuLine } from './menu'
import type { ItemStatus } from './MarStatus.vue'

/**
 * Spaces (Mar's proposal): the branded places a studio serves its
 * clients, as Pablo has them. Each card is the client's brand: its
 * colour and mark, its address, who's in it and what it has spent this
 * month. Live, draft or paused; Go live and Pause work from ⋯.
 */
const spaces = collection<Space & { project?: string; fav?: boolean }>(SPACES, 'space')

type Status = 'all' | Space['status']
const status = ref<Status>('all')
const sort = ref('name')
const query = ref('')
const view = ref<'grid' | 'list'>('grid')

const STATUSES = computed(() =>
  (
    [
      ['all', 'All'],
      ['live', 'Live'],
      ['draft', 'Draft'],
      ['paused', 'Paused']
    ] as const
  ).map(([value, label]) => ({
    value: value as Status,
    label,
    count: SPACES.filter((s) => value === 'all' || s.status === value).length
  }))
)
const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'spend', label: 'Spend' },
  { value: 'members', label: 'Members' }
]
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = SPACES.filter(
    (s) =>
      (status.value === 'all' || s.status === status.value) &&
      (!q || `${s.name} ${s.domain}`.toLowerCase().includes(q))
  )
  if (sort.value === 'spend') return [...list].sort((a, b) => b.used - a.used)
  if (sort.value === 'members') return [...list].sort((a, b) => b.members.length - a.members.length)
  return [...list].sort((a, b) => a.name.localeCompare(b.name))
})
const filtered = computed(() => status.value !== 'all' || !!query.value)
function clear(): void {
  status.value = 'all'
  query.value = ''
}
const lib = useLibrary(spaces, shown)

const STATUS: Record<Space['status'], ItemStatus> = {
  live: 'live',
  draft: 'draft',
  paused: 'paused'
}
const credits = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const meta = (s: Space): string =>
  `${s.domain} · ${count(s.members.length, 'member')} · ${credits(s.used)} of ${credits(s.budget)} credits`

function open(s: Space): void {
  go(`space:${s.id}` as Page)
}
function pause(s: Space, on: boolean): void {
  const before = s.status
  s.status = on ? 'paused' : 'live'
  notify(
    on ? `${s.name} is paused. Members see a notice; nothing runs.` : `${s.name} is live again`,
    () => (s.status = before)
  )
}
function lines(s: Space): MenuLine[] {
  return [
    { label: 'Open', icon: ExternalLink, run: () => open(s) },
    { label: 'Preview as client', icon: Eye, run: () => previewSpace(s.id) },
    ...(s.status === 'draft'
      ? []
      : [{ label: `Visit ${s.domain}`, icon: Globe2, run: () => toast(`Opening ${s.domain} ↗`) }]),
    { label: 'Invite members', icon: UserPlus, run: () => open(s) },
    'sep',
    s.status === 'draft'
      ? { label: 'Go live', icon: Rocket, run: () => goLive(s.id) }
      : s.status === 'paused'
        ? { label: 'Resume', icon: Play, run: () => pause(s, false) }
        : { label: 'Pause', icon: Pause, run: () => pause(s, true) },
    { label: 'Rename', icon: Pencil, run: () => (lib.renaming.value = s.id) },
    { label: 'Duplicate', icon: Copy, run: () => spaces.duplicate(s.id) },
    'sep',
    { label: 'Delete space', icon: Trash2, danger: true, run: () => spaces.remove([s.id]) }
  ]
}
</script>

<template>
  <MarPage
    title="Spaces"
    description="Branded places where your clients run the tools you publish for them."
    :skeleton="view === 'grid' ? 'grid' : 'list'"
    :no-results="shown.length === 0 && filtered"
    :state="shownState === 'live' && SPACES.length === 0 ? 'empty' : undefined"
    :empty="{
      icon: Globe2,
      title: 'Give a client their own space',
      text: 'Their brand, their address, the tools you publish for them, and a budget you control. They never see a graph.',
      pics: EMPTY_PICS.spaces,
      action: 'New space'
    }"
    error-text="Spaces live in Comfy Cloud, which is out of reach. Members can't run anything until it's back."
    @action="proto.creatingSpace = true"
    @clear="clear"
  >
    <template #actions="{ state }">
      <Button
        v-if="state === 'live' || state === 'loading'"
        variant="primary"
        @click="proto.creatingSpace = true"
        ><Plus :size="15" />Space</Button
      >
    </template>

    <template #toolbar>
      <MarSeg v-model="status" :options="STATUSES" label="Status" />
      <div class="ml-auto flex items-center gap-2">
        <Select v-model="sort" :options="SORTS" label="Sort" class="w-38" />
        <MarSearchField v-model="query" placeholder="Search spaces" />
        <MarViewToggle v-model="view" />
      </div>
    </template>

    <div v-if="view === 'grid'" class="mar-grid is-wide">
      <MarItem
        v-for="s in shown"
        :key="s.id"
        :name="s.name"
        :meta="meta(s)"
        :status="STATUS[s.status]"
        :fav="(s as { fav?: boolean }).fav"
        :lines="lines(s)"
        :selected="lib.sel.has(s.id)"
        :selecting="lib.sel.ids.value.size > 0"
        :renaming="lib.renaming.value === s.id"
        ratio="16 / 8"
        @open="open(s)"
        @select="lib.pick(s.id, $event)"
        @start-rename="lib.renaming.value = s.id"
        @rename="lib.rename(s.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
        @star="spaces.star(s.id)"
      >
        <template #media>
          <span class="mar-space-face" :style="{ '--brand': s.brand.color }">
            <SpaceMark :brand="s.brand" size="lg" />
            <span class="mar-space-line">{{ s.brand.headline.replace('{name}', 'Maya') }}</span>
            <span
              class="mar-space-meter"
              :title="`${Math.round((s.used / s.budget) * 100)}% of the budget`"
              ><i :style="{ width: `${Math.min(100, (s.used / s.budget) * 100)}%` }"
            /></span>
          </span>
        </template>
      </MarItem>
    </div>
    <div v-else class="mar-table is-items" style="--mar-cols: 96px 160px">
      <div class="mar-table-head">
        <span>Space</span><span class="is-num">Members</span><span class="is-num">Spend</span
        ><span class="is-end">State</span><span />
      </div>
      <MarItem
        v-for="s in shown"
        :key="s.id"
        layout="list"
        :name="s.name"
        :meta="s.domain"
        :status="STATUS[s.status]"
        :fav="(s as { fav?: boolean }).fav"
        :lines="lines(s)"
        :selected="lib.sel.has(s.id)"
        :selecting="lib.sel.ids.value.size > 0"
        :renaming="lib.renaming.value === s.id"
        @open="open(s)"
        @select="lib.pick(s.id, $event)"
        @start-rename="lib.renaming.value = s.id"
        @rename="lib.rename(s.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
        @star="spaces.star(s.id)"
      >
        <template #media>
          <span class="flex size-full items-center justify-center"
            ><SpaceMark :brand="s.brand" size="md"
          /></span>
        </template>
        <template #cols>
          <span class="mar-item-col is-num">{{ s.members.length }}</span>
          <span class="mar-item-col is-num">{{ credits(s.used) }} / {{ credits(s.budget) }}</span>
        </template>
      </MarItem>
    </div>

    <MarSelectBar
      :n="lib.sel.ids.value.size"
      noun="space"
      :actions="[
        {
          label: 'Pause',
          icon: Pause,
          run: () => (
            SPACES.filter((s) => lib.sel.has(s.id) && s.status === 'live').forEach(
              (s) => (s.status = 'paused')
            ),
            lib.sel.clear()
          )
        },
        { label: 'Delete', icon: Trash2, danger: true, run: lib.removeSelected }
      ]"
      @clear="lib.sel.clear()"
      @all="lib.sel.all(lib.order.value)"
    />
  </MarPage>
</template>

<style>
.mar-space-face {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px;
  background:
    radial-gradient(
      130% 120% at 100% 0%,
      color-mix(in oklch, var(--brand) 55%, transparent),
      transparent 65%
    ),
    linear-gradient(160deg, color-mix(in oklch, var(--brand) 22%, #101012), #0c0c0e);
  color: #fff;
}
.mar-space-face > :first-child {
  position: absolute;
  top: 16px;
  left: 16px;
}
.mar-space-line {
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-space-meter {
  display: block;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.16);
}
.mar-space-meter i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: rgb(255 255 255 / 0.85);
}
.mar-space-face ~ .mar-item-status {
  top: 14px;
  right: 76px;
  bottom: auto;
  left: auto;
}
</style>
