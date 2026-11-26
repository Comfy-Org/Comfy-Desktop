<script setup lang="ts">
import { computed, ref } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import Greeting from '../parts/Greeting.vue'
import PromptBox from '../parts/PromptBox.vue'
import WhatsNew from './WhatsNew.vue'
import LaunchBanner from './LaunchBanner.vue'
import LaunchesRow from '../parts/LaunchesRow.vue'
import MarStart from './MarStart.vue'
import StarterCards from '../parts/StarterCards.vue'
import MarSpacesRow from './MarSpacesRow.vue'
import MarBuildsRow from './MarBuildsRow.vue'
import ExampleArc from './userStates/ExampleArc.vue'
import HomeLoadFailed from './offline/HomeLoadFailed.vue'
import { offline } from './offline/connection'
import HomeArcMix from './userStates/HomeArcMix.vue'
import AppStrip from './home/AppStrip.vue'
import { arcApps } from './userStates/arcItems'
import { firstTime } from './userStates/userState'
import ExampleShowcase from './userStates/ExampleShowcase.vue'
import { EXAMPLES, runExample, type Example } from './userStates/examples'
import HomeInstall from './setup/HomeInstall.vue'
import {
  cardInBuilds,
  flow,
  homeOpen,
  installingBehind,
  installPending,
  setupOn
} from './setup/setupFlow'
import { SPACES } from '../spaces'
import { onCloud } from './shell/surface'
import { p20 } from './p20/p20'
import FilmstripRow from './p20/FilmstripRow.vue'
import TableRow from './p20/TableRow.vue'
import SpotlightCarousel from './p20/SpotlightCarousel.vue'
import GradientSpacesRow from './p20/GradientSpacesRow.vue'
import BuildHealthRow from './p20/BuildHealthRow.vue'
import Button from '../ui/Button.vue'
import ScrollRow from '../ui/ScrollRow.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import BuildPill from './BuildPill.vue'
import CreateMenu from './CreateMenu.vue'
import WorkflowCard from './WorkflowCard.vue'
import { active as parts } from './marParts'
import { allWorkflows } from '../gallery'
import {
  go,
  hostActions,
  instanceById,
  instances,
  openDetail,
  proto,
  recentInstances
} from '../useProto'
import type { ProtoInstance } from '../mock'
import { can } from '../milestones'
import { shownName } from '../account'
import { TEMPLATES, thumb } from '../mock'
import { mock } from './assets/mock'
import { recentsCover } from './cover'
import MarHomeTour from './homeTour/MarHomeTour.vue'
import HomeSectionHeader from './HomeSectionHeader.vue'
import NewWorkflowTile from './NewWorkflowTile.vue'
import { openCreate } from './create/createScreen'
import { onHome } from './tunerContext'
import { search } from './search/search'
import { homeLayout } from './home/homeLayout'
import { homeIdeaOn } from './home/homeIdeas'
import RecentList, { type RecentListRow } from './RecentList.vue'
import { edited, lastOutput } from './create/smartSearch'

/**
 * Home: which version of each section shows is picked in marParts.ts. What
 * it holds follows the milestone.
 */
function openInNewTab(env: ProtoInstance, workflow: string): void {
  if (env.kind === 'cloud' && !proto.signedIn) return hostActions.launch(env, workflow)
  proto.detail = null
  proto.activeInstanceId = env.id
  const id = `tab-${Date.now()}`
  proto.tabs.push({ id, title: env.name, instanceId: env.id, workflow })
  proto.activeTab = id
}

const noLocal = computed(() => !instances.value.some((i) => i.kind === 'local'))
// First run: a first-time user before any local install (UI Playground ›
// User and Local install). A returning user with no local install (on
// Cloud) gets the returning Home; a first-time user with a fresh build
// gets it too, with examples where their work will go.
// Signed in, Home greets the account by its first name (the real one when
// there is one); signed out it stays generic.
const greeting = computed(() => {
  const first = proto.signedIn ? shownName.value?.split(' ')[0] : ''
  if (firstTime.value)
    return first ? `Welcome, ${first}. Let's create!` : "Welcome to Comfy. Let's create!"
  return first ? `Welcome back, ${first}. Let's create!` : "Let's create!"
})
const firstRun = computed(() => firstTime.value && noLocal.value)
// Home first, Local picked and not installed yet: the install waits (or
// runs) on its card, with the apps under it (setup/HomeInstall.vue). Open
// ComfyUI never shows before there is one. With the card only, the rest
// that needs ComfyUI waits: the prompt, which could only run on Comfy
// Cloud, and the first-run examples. With pick to install they stay.
// With the card in Builds (UI Playground › Local setup › Install card) the
// Home is the usual one: the apps, then Builds with the install as its
// first build.
const gated = computed(() => installPending.value && !homeOpen.value && !cardInBuilds.value)
const builds = computed(() => recentInstances.value.slice(0, 3))
// The top keeps the same room whether or not a build is installing: the
// Home never changes height between states.
const tight = computed(() => parts.value.top === 'tight')
const tourActive = computed(
  () =>
    can.value.onboarding &&
    onHome.value &&
    proto.mode === 'create' &&
    !(flow.open && flow.takeover) &&
    !installingBehind.value &&
    !proto.detail &&
    !proto.deploying &&
    !search.open
)
const recentsCoverKind = computed(() => (can.value.onboarding ? recentsCover.id : undefined))

// Example workflows as compact rows (Exploration 17): photo, title, what it does.
const EXAMPLE_ART = [1, 2, 3, 4, 5].map((n) => mock(`home-example-${n}`))
const exampleRows = computed(() =>
  TEMPLATES.filter((t) => t.kind === 'graph')
    .slice(0, 5)
    .map((t, i) => {
      const [title, what] = t.title.split(':').map((x) => x.trim())
      return { id: t.id, title: title!, what: what ?? t.category, src: EXAMPLE_ART[i]! }
    })
)

// Apps used lately (samples), in minutes ago like a workflow's age.
const USED_APPS: { x: Example; age: number; when: string }[] = [
  { x: EXAMPLES[3]!, age: 30, when: '30 min ago' },
  { x: EXAMPLES[0]!, age: 1440, when: 'Yesterday' },
  { x: EXAMPLES[2]!, age: 4320, when: '3 days ago' }
]

type Recent = {
  id: string
  src: string
  output?: string
  title: string
  meta: string
  when: string
  age: number
  app?: boolean
  open: () => void
}
const recent = computed<Recent[]>(() =>
  [
    ...allWorkflows.value.map((w): Recent => {
      const env = w.envId ? instanceById(w.envId) : undefined
      return {
        id: w.id,
        // The workflow's own picture, the one it has everywhere.
        src: thumb(w.thumbId),
        output: lastOutput(w),
        title: w.name.replace(/\.json$/, ''),
        meta: env?.name ?? '',
        when: w.modified,
        age: w.age,
        open: () =>
          can.value.onboarding && env
            ? openInNewTab(env, w.name.replace(/\.json$/, ''))
            : openDetail('workflow', w.id)
      }
    }),
    // With the own workflows (Recents & Assets), the apps used lately mix in.
    ...(can.value.workflows && !can.value.onboarding && !firstTime.value
      ? USED_APPS.map(
          ({ x, age, when }): Recent => ({
            id: `app-${x.app}`,
            src: x.after,
            title: x.label,
            meta: 'App',
            when,
            age,
            app: true,
            open: () => runExample(x)
          })
        )
      : [])
  ]
    .sort((a, b) => a.age - b.age)
    .slice(0, 8)
)
const recentsFirst = computed(() => homeLayout.id === 'recents' && can.value.exploreApps)
const homeEl = ref<HTMLElement>()
const paneWidth = ref(0)
useResizeObserver(
  () => (recentsFirst.value ? homeEl.value?.parentElement : undefined),
  ([entry]) => (paneWidth.value = entry?.contentRect.width ?? 0)
)
const homeStyle = computed(() =>
  recentsFirst.value && paneWidth.value ? { '--mar-pane': `${paneWidth.value}px` } : undefined
)
const RECENT_COLUMNS = 5
const COMPACT_RECENTS = 5
const ideaThumbs = computed(() => recentsFirst.value && homeIdeaOn('thumbs'))
const ideaHeaders = computed(() => recentsFirst.value && homeIdeaOn('headers'))
const ideaCleanCards = computed(() => recentsFirst.value && homeIdeaOn('cleanCards'))
const ideaCompactRecents = computed(() => recentsFirst.value && homeIdeaOn('compactRecents'))
const ideaSmallGreeting = computed(() => recentsFirst.value && homeIdeaOn('smallGreeting'))
const recentHasRoom = computed(
  () => !ideaCompactRecents.value && recent.value.length < RECENT_COLUMNS
)
const recentCoverOf = (r: Recent) =>
  ideaThumbs.value && r.output ? 'image' : recentsCoverKind.value
const recentSrcOf = (r: Recent): string => (ideaThumbs.value && r.output) || r.src
const compactRows = computed<RecentListRow[]>(() =>
  recent.value.slice(0, COMPACT_RECENTS).map((r) => ({
    id: r.id,
    name: r.title,
    build: r.meta,
    edited: r.app ? r.when : edited(r.when),
    src: r.app ? r.src : r.output
  }))
)
const compactActive = ref<string>()
function openRecent(id: string): void {
  recent.value.find((r) => r.id === id)?.open()
}
</script>

<template>
  <div class="mar-top-actions absolute top-3.5 right-4 z-10 flex items-center gap-2">
    <!-- Open ComfyUI comes back with the build; the top card carries it
         while it is there, the Builds card does not. -->
    <CreateMenu v-if="!can.onboarding && !installPending && (!flow.ready || cardInBuilds)" />
  </div>
  <div
    ref="homeEl"
    class="mar-home mx-auto min-h-full w-full max-w-300 px-10 pb-16"
    :class="recentsFirst && 'is-recents-first'"
    :style="homeStyle"
  >
    <!-- First run or not, the top is the same: the greeting and the prompt
         sit where a returning user finds them. -->
    <section
      :class="[
        'flex flex-col',
        ideaSmallGreeting ? 'pt-10 pb-2' : tight ? 'pt-14 pb-4' : 'pt-12 pb-4'
      ]"
    >
      <div
        :class="[
          'flex flex-1 flex-col',
          !tight && !ideaSmallGreeting ? 'justify-center pt-10' : ''
        ]"
      >
        <Greeting
          :text="greeting"
          :class="[
            'mar-greeting',
            ideaSmallGreeting && 'mar-greeting-small',
            tight ? 'mb-4! pt-0!' : ''
          ]"
        />
        <!-- One line tall; while you type it grows over what's below. -->
        <div v-if="can.agent && !gated" class="mar-prompt-slot">
          <PromptBox target class="mar-prompt" />
        </div>
        <template v-if="!firstRun">
          <BuildHealthRow v-if="p20.builds === 'health'" />
          <div v-if="parts.builds === 'mar'" class="mx-auto mt-8 w-full max-w-210">
            <div class="mb-2.5 flex items-center justify-between px-1">
              <span class="text-ui text-muted-foreground">Or launch ComfyUI</span>
              <Button variant="link" size="sm" @click="go('environments')">All builds</Button>
            </div>
            <div class="grid grid-cols-3 gap-2">
              <BuildPill v-for="i in builds" :key="i.id" :inst="i" />
            </div>
          </div>
        </template>
      </div>
    </section>

    <!-- First run: the same sections, filled with ways to start instead of
         your work (UI Playground › First run). -->
    <!-- Home first: Local was picked on Run on, so the install waits here. -->
    <HomeInstall v-if="(installPending || flow.ready) && !cardInBuilds" />
    <template v-if="gated"></template>
    <MarStart v-else-if="firstRun && !cardInBuilds" />
    <div v-else>
      <!-- The Apps stage: the apps arc leads for everyone from Milestone 2
           on; from Milestone 3 Apps | Workflows tabs sit over it (layout in
           UI Playground › Apps and templates). -->
      <template v-if="!recentsFirst">
        <HomeArcMix v-if="can.explore" class="mt-6" />
        <HomeLoadFailed v-else-if="can.exploreApps && offline" class="mt-6" />
        <ExampleArc v-else-if="can.exploreApps" class="mt-6" />
        <MarBuildsRow v-if="!onCloud" />
      </template>
      <!-- A first-time user with a build: nothing of theirs yet, so the
           examples take Recently used's place (UI Playground › First-time
           examples). Not once the apps arc leads the Home (Milestone 2):
           it would be the same arc twice. -->
      <section v-if="firstTime && !recent.length && !setupOn && !can.exploreApps" class="mt-10">
        <SectionHeader
          class="mar-sec"
          title="Start from an example"
          :link="can.explore ? 'All examples' : undefined"
          @link="go('explore')"
        >
          <template #controls>
            <span
              class="inline-flex h-5 items-center rounded-full bg-secondary-background px-2 text-ui text-muted-foreground"
              >{{ EXAMPLES.length }}</span
            >
          </template>
        </SectionHeader>
        <ExampleShowcase />
      </section>
      <section v-if="parts.examples === 'mar'" class="mx-auto mt-8 w-full max-w-180">
        <SectionHeader
          class="mar-sec"
          title="Example workflows"
          :link="can.explore ? 'All examples' : undefined"
          @link="go('explore')"
        >
          <template #controls>
            <span
              class="inline-flex h-5 items-center rounded-full bg-secondary-background px-2 text-ui text-muted-foreground"
              >{{ TEMPLATES.length }}</span
            >
          </template>
        </SectionHeader>
        <StarterCards />
      </section>

      <!-- Milestone 2 is apps only: Recently used comes back with Workflows
           (Recents & Assets), apps and workflows together. -->
      <section
        v-if="recent.length && (can.workflows || !can.exploreApps)"
        :class="recentsFirst ? 'mt-6' : 'mt-10'"
      >
        <HomeSectionHeader
          v-if="can.onboarding"
          title="Recently used"
          link-tip="All workflows"
          add-label="New workflow"
          :add="recentHasRoom ? 'never' : 'always'"
          @open="go('workflows')"
          @add="openCreate()"
        />
        <SectionHeader
          v-else
          class="mar-sec"
          title="Recently used"
          :link="can.workflows ? 'All workflows' : undefined"
          @link="go('workflows')"
        />
        <FilmstripRow v-if="p20.recent === 'filmstrip'" />
        <TableRow v-else-if="p20.recent === 'table'" />
        <RecentList
          v-else-if="ideaCompactRecents"
          :rows="compactRows"
          :active="compactActive"
          @hover="(id) => (compactActive = id)"
          @open="(row) => openRecent(row.id)"
        />
        <ScrollRow v-else :columns="RECENT_COLUMNS" class="mar-recent-row">
          <WorkflowCard
            v-for="r in recent"
            :key="r.id"
            :src="recentSrcOf(r)"
            :title="r.title"
            :meta="r.meta"
            :right="r.when"
            :app="r.app"
            :cover-kind="recentCoverOf(r)"
            @open="r.open()"
          />
          <NewWorkflowTile v-if="can.onboarding && recentHasRoom" @open="openCreate()" />
        </ScrollRow>
      </section>

      <template v-if="recentsFirst">
        <div class="mt-10">
          <HomeArcMix v-if="can.explore" full />
          <HomeLoadFailed v-else-if="offline" />
          <template v-else>
            <HomeSectionHeader
              v-if="ideaHeaders"
              title="Apps"
              link-tip="All apps"
              add-label="New app"
              @open="go('apps')"
            />
            <AppStrip
              :items="arcApps()"
              :headless="ideaHeaders"
              :all-label="ideaHeaders ? '' : undefined"
              :clean="ideaCleanCards"
              data-home-tour="apps-carousel"
              @all="go('apps')"
            />
          </template>
        </div>
        <MarBuildsRow v-if="!onCloud" />
      </template>

      <section v-if="parts.examples === 'rows'" class="mt-10">
        <SectionHeader
          class="mar-sec"
          title="Example workflows"
          :link="can.explore ? 'All examples' : undefined"
          @link="go('explore')"
        >
          <template #controls>
            <span class="text-ui text-subtle-foreground">{{ TEMPLATES.length }}</span>
          </template>
        </SectionHeader>
        <div class="grid grid-cols-5 gap-3">
          <button
            v-for="e in exampleRows"
            :key="e.id"
            type="button"
            class="mar-surface flex min-w-0 items-center gap-3 rounded-card p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            @click="openDetail('template', e.id)"
          >
            <img :src="e.src" alt="" class="size-12 shrink-0 rounded-control object-cover" />
            <span class="min-w-0">
              <span class="block truncate text-ui font-medium">{{ e.title }}</span>
              <span class="block truncate text-ui text-subtle-foreground">{{ e.what }}</span>
            </span>
          </button>
        </div>
      </section>
    </div>

    <!-- What's new waits for the Builder: at Explore & Learn the apps lead. -->
    <template v-if="can.builder && !can.onboarding">
      <SpotlightCarousel v-if="p20.news === 'spotlight'" />
      <WhatsNew v-else-if="parts.news === 'mar'" />
      <LaunchBanner v-else-if="parts.news === 'banner'" />
      <LaunchesRow v-else />
    </template>
    <!-- Spaces only once there are some: a first-time user has none (the
         sidebar invites them to make one). -->
    <template v-if="can.spaces && proto.signedIn && SPACES.length">
      <GradientSpacesRow v-if="p20.spaces === 'gradient'" />
      <MarSpacesRow v-else />
    </template>
  </div>
  <div
    aria-hidden="true"
    class="pointer-events-none sticky bottom-0 -mt-32 h-32 bg-[linear-gradient(to_top,var(--color-content-background)_15%,transparent)]"
  />
  <MarHomeTour v-if="can.onboarding" :active="tourActive" />
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-home h1.mar-greeting-small {
  margin-bottom: 20px;
  padding-top: 0;
  font-size: var(--text-title, 24px);
  letter-spacing: -0.01em;
  line-height: 1.25;
  text-align: left;
}
</style>
