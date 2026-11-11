<script setup lang="ts">
import { computed } from 'vue'
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
import { firstTime } from './userStates/userState'
import ExampleShowcase from './userStates/ExampleShowcase.vue'
import { EXAMPLES } from './userStates/examples'
import HomeInstall from './setup/HomeInstall.vue'
import { cardInBuilds, flow, homeOpen, installPending, setupOn } from './setup/setupFlow'
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
import { can } from '../milestones'
import { shownName } from '../account'
import { TEMPLATES, thumb, type ProtoInstance } from '../mock'
import { mock } from './assets/mock'

/** A recent workflow opens in ComfyUI's graph, in this window, at any
 *  milestone: each one is a graph of nodes, so that's where it lands. */
function openRecent(env: ProtoInstance, workflow: string): void {
  if (can.value.oneWindow) return hostActions.launch(env, workflow)
  proto.detail = null
  proto.activeInstanceId = env.id
  const id = `tab-${Date.now()}`
  proto.tabs = [{ id, title: env.name, instanceId: env.id, workflow }]
  proto.activeTab = id
}

/**
 * Home: which version of each section shows is picked in marParts.ts. What
 * it holds follows the milestone.
 */
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
// With the install card in Builds the top sits tight, so Builds and the
// card stay on screen at 1280 × 800 while it installs.
const tight = computed(() => parts.value.top === 'tight' || cardInBuilds.value)

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

const recent = computed(() =>
  [...allWorkflows.value]
    .sort((a, b) => a.age - b.age)
    .slice(0, 8)
    .map((w) => {
      const env = w.envId ? instanceById(w.envId) : undefined
      return {
        w,
        env,
        // The workflow's own picture, the one it has everywhere.
        src: thumb(w.thumbId),
        title: w.name.replace(/\.json$/, '')
      }
    })
)
</script>

<template>
  <div class="mar-top-actions absolute top-3.5 right-4 z-10 flex items-center gap-2">
    <!-- Open ComfyUI comes back with the build; the top card carries it
         while it is there, the Builds card does not. -->
    <CreateMenu v-if="!installPending && (!flow.ready || cardInBuilds)" />
  </div>
  <div class="mar-home mx-auto min-h-full w-full max-w-300 px-10 pb-16">
    <!-- First run or not, the top is the same: the greeting and the prompt
         sit where a returning user finds them. -->
    <section :class="['flex flex-col', tight ? 'pt-14 pb-4' : 'pt-12 pb-4']">
      <div :class="['flex flex-1 flex-col', !tight ? 'justify-center pt-10' : '']">
        <Greeting :text="greeting" :class="['mar-greeting', tight ? 'mb-4! pt-0!' : '']" />
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
      <!-- The Apps stage: the examples arc leads for everyone, from
           Milestone 2 on. -->
      <ExampleArc v-if="can.exploreApps" class="mt-6" />
      <MarBuildsRow v-if="!onCloud" />
      <!-- A first-time user with a build: nothing of theirs yet, so the
           examples take Recently used's place (UI Playground › First-time
           examples). -->
      <section v-if="firstTime && !recent.length && !setupOn" class="mt-10">
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

      <!-- Milestone 2 is apps only: Recently used comes back with Explore &
           Learn. -->
      <section v-if="recent.length && (can.explore || !can.exploreApps)" class="mt-10">
        <SectionHeader
          class="mar-sec"
          title="Recently used"
          :link="can.projects ? 'All workflows' : undefined"
          @link="go('workflows')"
        />
        <FilmstripRow v-if="p20.recent === 'filmstrip'" />
        <TableRow v-else-if="p20.recent === 'table'" />
        <ScrollRow v-else :columns="5" class="mar-recent-row">
          <WorkflowCard
            v-for="r in recent"
            :key="r.w.id"
            :src="r.src"
            :title="r.title"
            :meta="r.env?.name ?? ''"
            :right="r.w.modified"
            @open="r.env && openRecent(r.env, r.w.name)"
          />
        </ScrollRow>
      </section>

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
    <template v-if="can.builder">
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
</template>
