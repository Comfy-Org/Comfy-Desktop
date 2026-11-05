<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  Activity,
  ExternalLink,
  Eye,
  Globe,
  Pause,
  Play,
  Rocket,
  Trash2,
  UserPlus,
  Users,
  Wrench
} from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import SpaceMark from '../../parts/space/SpaceMark.vue'
import MembersTable from '../../parts/space/MembersTable.vue'
import SpaceActivity from '../../pages/spaces/SpaceActivity.vue'
import SpaceCatalog from '../../pages/spaces/SpaceCatalog.vue'
import SpaceHomeBrand from '../../pages/spaces/SpaceHomeBrand.vue'
import SpaceAccess from '../../pages/spaces/SpaceAccess.vue'
import SpaceSettings from '../../pages/spaces/SpaceSettings.vue'
import SpaceUsage from '../../pages/spaces/SpaceUsage.vue'
import { SPACES, goLive, previewSpace, type Space } from '../../spaces'
import { shownState } from './pageState'
import { go, toast } from '../../useProto'
import MarPage from './MarPage.vue'
import MarEmpty from './MarEmpty.vue'
import { EMPTY_PICS } from './emptyArt'
import MemberAvatar from '../../parts/MemberAvatar.vue'
import MarEntityHeader from './MarEntityHeader.vue'
import MarAddress from './MarAddress.vue'
import MarSplitButton from './MarSplitButton.vue'
import MarSeg from './MarSeg.vue'
import MarSpaceOverview from './MarSpaceOverview.vue'
import MarSpaceSetup from './MarSpaceSetup.vue'
import MarItemMenu from './MarItemMenu.vue'
import { notify } from './undo'
import type { MenuLine } from './menu'

/**
 * One space (Mar's proposal): the shared header (mark, name, state, the
 * address, members and last activity; Invite, Open site ▾, ⋯) under a
 * cover in the brand's colours (MarBackdrop), then the shared tab group
 * and the panels: Mar's overview, Pablo's tools, brand, members, usage,
 * activity and settings, inside the shared page frame so Loading and
 * Error apply here too.
 */
const { id } = defineProps<{ id: string }>()
const space = computed(() => SPACES.find((s) => s.id === id))
// Page state Empty shows the space as just made: a draft with nothing in
// it yet. Live shows its own data.
const fresh = computed(() => shownState.value === 'empty')
const view = computed<Space | undefined>(() => {
  const s = space.value
  if (!s || !fresh.value) return s
  const made = s.activity.find((a) => a.what === 'created the space')
  return {
    ...s,
    status: 'draft',
    brand: { ...s.brand, headline: '' },
    catalog: [],
    members: [],
    requests: [],
    used: 0,
    trend: s.trend.map(() => 0),
    activity: [made ?? { who: 'You', what: 'created the space', when: 'Today', studio: true }]
  }
})

// Nothing to measure yet (no runs, nobody in it): the overview becomes the
// steps that get the space ready instead of a dashboard of zeros.
const setup = computed(
  () => !!view.value && !view.value.members.length && !view.value.catalog.some((c) => c.runs)
)
const created = computed(() => view.value?.activity.find((a) => a.what === 'created the space'))

type Tab = 'overview' | 'catalog' | 'home' | 'members' | 'usage' | 'activity' | 'settings'
const tab = ref<Tab>('overview')
const members = ref<InstanceType<typeof MembersTable>>()
const TABS = computed(() => [
  { value: 'overview' as Tab, label: 'Overview' },
  { value: 'catalog' as Tab, label: 'Tools', count: view.value?.catalog.length },
  { value: 'home' as Tab, label: 'Home & brand' },
  { value: 'members' as Tab, label: 'Members', count: view.value?.members.length },
  { value: 'usage' as Tab, label: 'Usage' },
  { value: 'activity' as Tab, label: 'Activity' },
  { value: 'settings' as Tab, label: 'Settings' }
])

// An empty tab shows its invitation until you act on it.
const opened = reactive({ catalog: false, members: false })
function invite(): void {
  tab.value = 'members'
  opened.members = true
  setTimeout(() => members.value?.invite())
}
function setPaused(on: boolean): void {
  const s = space.value
  if (!s) return
  const before = s.status
  s.status = on ? 'paused' : 'live'
  notify(on ? `${s.name} is paused` : `${s.name} is live again`, () => (s.status = before))
}
// The primary's menu: the address and the other way to look at the site.
const liveLines = computed<MenuLine[]>(() => {
  const s = space.value
  if (!s) return []
  return [
    {
      label: s.domain,
      icon: Globe,
      hint: 'Copy',
      run: () => {
        void navigator.clipboard?.writeText(`https://${s.domain}`).catch(() => {})
        toast('Address copied')
      }
    },
    { label: 'Preview as client', icon: Eye, run: () => previewSpace(s.id) }
  ]
})
const draftLines = computed<MenuLine[]>(() => {
  const s = space.value
  if (!s) return []
  return [
    { label: 'Go live', icon: Rocket, run: () => goLive(s.id) },
    { label: `${s.domain}, once live`, icon: Globe, disabled: true }
  ]
})
const lastActive = computed(() => {
  const m = view.value?.members ?? []
  return (m.find((x) => x.lastActive === 'Now') ?? m[0])?.lastActive.toLowerCase()
})

const lines = computed<MenuLine[]>(() => {
  const s = space.value
  if (!s) return []
  return [
    ...(s.status === 'live' ? [{ label: 'Pause', icon: Pause, run: () => setPaused(true) }] : []),
    ...(s.status === 'paused'
      ? [{ label: 'Resume', icon: Play, run: () => setPaused(false) }]
      : []),
    'sep',
    {
      label: 'Delete space',
      icon: Trash2,
      danger: true,
      run: () => {
        SPACES.splice(SPACES.indexOf(s), 1)
        go('spaces')
      }
    }
  ]
})
</script>

<template>
  <MarPage
    v-if="!space"
    title="Space"
    state="empty"
    :empty="{
      icon: Trash2,
      title: 'This space is gone',
      text: 'It was deleted, or you no longer manage it.',
      action: 'All spaces'
    }"
    @action="go('spaces')"
  />
  <MarPage
    v-else
    :title="space.name"
    skeleton="settings"
    error-title="Can't load this space"
    :state="fresh ? 'live' : undefined"
    error-text="It lives in Comfy Cloud, which is out of reach. Its members can't run anything until it's back either."
  >
    <template #header>
      <MarEntityHeader
        class="mar-space-head"
        :style="{ '--space-accent': space.brand.color }"
        back="Spaces"
        :title="space.name"
        :status="view!.status"
        @back="go('spaces')"
      >
        <template #cover
          ><SpaceMark :brand="space.brand" size="lg" class="mar-space-logo"
        /></template>
        <template #meta>
          <MarAddress :address="space.domain" :pending="space.status === 'draft'" />
          <span class="mar-eh-dot" />
          <button type="button" class="mar-eh-link" @click="tab = 'members'">
            <span class="mar-eh-faces">
              <MemberAvatar
                v-for="m in view!.members.slice(0, 4)"
                :key="m.email"
                :name="m.name"
                size="sm"
              />
            </span>
            {{ view!.members.length }} {{ view!.members.length === 1 ? 'member' : 'members' }}
          </button>
          <template v-if="lastActive">
            <span class="mar-eh-dot" />
            <span>Last activity {{ lastActive }}</span>
          </template>
          <template v-else-if="created">
            <span class="mar-eh-dot" />
            <span>Created {{ created.when.toLowerCase() }} by {{ created.who }}</span>
          </template>
        </template>
        <template #actions>
          <Button @click="invite"><UserPlus :size="15" />Invite</Button>
          <MarSplitButton
            v-if="view!.status === 'draft'"
            label="Preview"
            :icon="Eye"
            :lines="draftLines"
            menu-label="More ways to open"
            @run="previewSpace(space.id)"
          />
          <MarSplitButton
            v-else
            label="Open site"
            :icon="ExternalLink"
            :lines="liveLines"
            menu-label="More ways to open"
            @run="toast(`Opening ${space.domain}`)"
          />
          <MarItemMenu :lines label="Space actions" />
        </template>
      </MarEntityHeader>
    </template>

    <template #tabs="{ state }">
      <div v-if="state === 'live'" class="mar-space-tabs">
        <MarSeg v-model="tab" :options="TABS" label="Space" />
      </div>
    </template>

    <MarSpaceSetup
      v-if="tab === 'overview' && setup"
      :space="view!"
      @tab="(t: Tab) => (tab = t)"
      @invite="invite"
      @live="goLive(space.id)"
    />
    <MarSpaceOverview
      v-else-if="tab === 'overview'"
      :space="view!"
      @tab="(t: Tab) => (tab = t)"
      @invite="invite"
    />
    <MarEmpty
      v-else-if="tab === 'catalog' && !view!.catalog.length && !opened.catalog"
      :icon="Wrench"
      title="No tools in this space yet"
      text="Publish an app or a workflow here and its members can run it, in their brand, without seeing a graph."
      :pics="EMPTY_PICS.tools"
      action="Add a tool"
      compact
      @action="opened.catalog = true"
    />
    <SpaceCatalog v-else-if="tab === 'catalog'" :space-id="space.id" />
    <SpaceHomeBrand v-else-if="tab === 'home'" :space-id="space.id" />
    <MarEmpty
      v-else-if="tab === 'members' && !view!.members.length && !opened.members"
      :icon="Users"
      title="Nobody in this space yet"
      text="Invite the client’s team. They sign in at the space’s address and only ever see this space."
      :pics="EMPTY_PICS.people"
      action="Invite people"
      compact
      @action="invite"
    />
    <div v-else-if="tab === 'members'" class="mt-8 flex flex-col gap-3.5">
      <MembersTable ref="members" :space-id="space.id" />
      <SpaceAccess :space-id="space.id" />
    </div>
    <SpaceUsage v-else-if="tab === 'usage'" :space-id="space.id" />
    <MarEmpty
      v-else-if="tab === 'activity' && (view!.status === 'draft' || !view!.members.length)"
      :icon="Activity"
      title="Nothing has happened here yet"
      text="Runs, invites and requests from members show up here once the space is live and people use it."
      :pics="EMPTY_PICS.activity"
      :action="space.status === 'draft' ? 'Go live' : 'Invite people'"
      compact
      @action="space.status === 'draft' ? goLive(space.id) : invite()"
    />
    <SpaceActivity v-else-if="tab === 'activity'" :space />
    <SpaceSettings v-else :space-id="space.id" />
  </MarPage>
</template>

<style>
/* The logo fills the header's cover: one tile, not a tile on a tile. */
:root .proto-ui.proto-ui.proto-ui .mar-space-head .mar-eh-cover {
  width: 72px;
  height: 72px;
  border-radius: 18px;
  /* A hairline so a white or black tile keeps its edge, and a glow in the
     brand's colour so it sits in its own light. */
  box-shadow:
    0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 10%, transparent),
    0 14px 36px -14px color-mix(in oklch, var(--space-accent) 55%, transparent);
}
.mar-space-logo,
.mar-space-logo > .space-mark {
  width: 100%;
  height: 100%;
}
:root .proto-ui.proto-ui.proto-ui .mar-space-logo > .space-mark {
  padding: 17px;
  border-radius: 0;
  box-shadow: none;
}
/* A narrow window: the meta wraps instead of running under the actions. */
.mar-space-head .mar-eh-meta {
  flex-wrap: wrap;
  row-gap: 2px;
}
/* The tabs sit on their own track, so no rule under them. */
.mar-space-tabs {
  margin-bottom: 24px;
}
</style>
