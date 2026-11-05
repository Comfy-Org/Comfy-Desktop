<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Moon, Sun, X } from 'lucide-vue-next'
import Button from '../ui/Button.vue'
import { DIRECTIONS, look } from '../look'
import { KNOBS, tuner, tuning, type Tuning } from './uiTuner'
import { onCloud, SURFACES, surface } from './shell/surface'
import { homeBackground, marNav, type HomeBackground, type MarNav } from './shell/marShell'
import { DISPLAYS, SCREENS, ZOOMS, screen } from './screen'
import Select from '../ui/Select.vue'
import { PALETTES, palette } from './palette'
import { COVERS, cover } from './cover'
import { BUILD_CARDS, buildCard } from './pages/buildCard'
import { BUILD_PAGES, buildPage } from './build/buildPage'
import { homeBuilds } from './homeBuilds'
import { APPS_STAGES, appsStage } from './apps/appsStage'
import { TEMPLATE_STYLES, templateStyle } from './brand/templateStyle'
import { BRAND_MOTIFS, brandMotif } from './brand/brandMotif'
import { CREDITS_STATES, creditsState } from './credits'
import { P20, p20 } from './p20/p20'
import { GRAPH_STYLES, graphStyle } from './graph/graphStyle'
import { FIRST_RUNS, firstRun } from './firstRun'
import {
  LOCAL_SETUPS,
  SETUP_SCOPES,
  MACHINES,
  SETUP_GPUS,
  SETUP_OSES,
  SETUP_SCREENS,
  canvas,
  RUN_ON_CARDS,
  localSetup,
  openSetup,
  showScreen,
  type Screen
} from './setup/setupFlow'
import { EXAMPLE_LOOKS, exampleLook } from './userStates/exampleLook'
import { EDITOR_ENTRIES, editorEntry } from './userStates/editorEntry'
import { MAR_LOCALS, MAR_USERS, marUser, setUser } from './userStates/userState'
import { PAGE_STATES, pageState } from './pages/pageState'
import { LOOKS, marLook } from './looks/looks'
import { SCENARIOS, dep, scenarioPick, type Scenario } from './deploy/deployData'
import { proto } from '../useProto'
import { can } from '../milestones'
import { pageName, shownPorts, TWEAKS, when, type TweakId } from './tunerContext'
import NavOptionsTuner from './NavOptionsTuner.vue'
import Seg from './tuner/TunerSeg.vue'
import Row from './tuner/TunerRow.vue'
import GroupHead from './tuner/TunerGroupHead.vue'

/** The UI tuner panel (Prototype menu › UI Playground, ⌘.). Global
 *  (where, navigation, colour), States (the situation being
 *  simulated), This page (design options for the screen you're on),
 *  and More, folded (rare and exploratory). States and
 *  This page list only what changes the screen now (tunerContext.ts says
 *  when); a hidden tweak keeps its value. */
/** Local setup › Jump to: the last screen picked. */
const setupScreen = ref<Screen | null>(null)

const NAVS: { value: MarNav; label: string }[] = [
  { value: 'floating', label: 'Floating sidebar' },
  { value: 'tabs', label: '08 · Tabs · a bar on top' },
  { value: 'panels', label: 'Floating panels' }
]
const BACKGROUNDS: { value: HomeBackground; label: string }[] = [
  { value: 'spotlight', label: 'Spotlight · soft light' },
  { value: 'bloom', label: 'Latent bloom · colour out of grain' },
  { value: 'output', label: 'Latest output · blurred' },
  { value: 'canvas', label: 'Canvas · the editor’s dot grid' },
  { value: 'wires', label: 'Wires · a graph traced in light' },
  { value: 'grade', label: 'Latent grade · latest output, duotone' }
]
const HOME_BUILD_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' }
] as const
const ACCOUNTS = [
  { value: 'in', label: 'Signed in' },
  { value: 'out', label: 'Signed out' }
] as const
const account = computed({
  get: () => (proto.signedIn ? 'in' : 'out'),
  set: (v: 'in' | 'out') => (proto.signedIn = v === 'in')
})
const SURFACE_OPTIONS = SURFACES.map((sf) => ({
  value: sf.value,
  label: sf.value === 'desktop' ? 'Desktop' : 'Cloud'
}))
const DEPLOY_STATES = SCENARIOS.map((s) => ({ value: s.id, label: s.label }))
const deployState = computed({
  get: () => dep.scenario,
  set: (s: Scenario) => (scenarioPick.want = s)
})
const paletteOptions = PALETTES.map((p) => ({ value: p.id, label: p.label }))
const THEMES = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun }
] as const

const P20_ROWS: { key: keyof typeof P20; label: string }[] = [
  { key: 'recent', label: 'Recently used' },
  { key: 'news', label: "What's new" },
  { key: 'spaces', label: 'Spaces' },
  { key: 'builds', label: 'Builds' },
  { key: 'panel', label: 'Right panel' },
  { key: 'density', label: 'Density' },
  { key: 'rail', label: 'Collapsed rail' }
]
const p20Options = (k: keyof typeof P20): { value: string; label: string }[] => [...P20[k]]

const zoomOptions = ZOOMS.map((z) => ({ value: String(z), label: `${Math.round(z * 100)}%` }))
const zoomPick = computed({
  get: () => String(screen.zoom),
  set: (v: string) => (screen.zoom = Number(v))
})
const screenOptions = SCREENS.map((sc) => ({
  value: sc.id,
  label: sc.note,
  hint: sc.w ? sc.label : undefined
}))
const displayOptions = DISPLAYS.map((d) => ({ value: d.id, label: `${d.label} · ${d.note}` }))

function set(key: keyof Tuning, value: string): void {
  ;(tuning as Record<string, string>)[key] = value
}

// Which tweaks each group holds. This page lists only the ones whose
// predicate holds now; Reset and the dot follow what's listed.
const GLOBAL: TweakId[] = ['surface', 'nav', 'palette', 'theme', 'brandMotif']
// States: the situation being simulated (who, what's installed, signed in,
// how a page or the credits are doing), apart from the design options.
const STATES: { id: TweakId; show: () => boolean }[] = [
  // First run lives on Home.
  { id: 'user', show: () => can.value.home },
  { id: 'homeBuilds', show: () => when.homeBuilds.value },
  { id: 'appsStage', show: () => when.appsStage.value },
  { id: 'account', show: () => true },
  { id: 'pageState', show: () => when.pageState.value },
  { id: 'credits', show: () => when.credits.value },
  { id: 'deployState', show: () => when.deployState.value }
]
const PAGE: { id: TweakId; show: () => boolean }[] = [
  { id: 'homeBackground', show: () => when.homeBackground.value },
  { id: 'firstRun', show: () => when.firstRun.value },
  { id: 'exampleLook', show: () => when.exampleLook.value },
  { id: 'editorEntry', show: () => when.editorEntry.value },
  { id: 'templates', show: () => when.templates.value },
  { id: 'buildCard', show: () => when.buildCard.value },
  { id: 'buildPage', show: () => when.buildPage.value },
  { id: 'cover', show: () => when.cover.value },
  { id: 'graph', show: () => when.graph.value },
  { id: 'ports', show: () => shownPorts.value.length > 0 }
]
const MORE: TweakId[] = ['screen', 'look', 'knobs', 'p20']
const pageIds = computed(() => PAGE.filter((p) => p.show()).map((p) => p.id))
const stateIds = computed(() => STATES.filter((p) => p.show()).map((p) => p.id))
const shows = (id: TweakId): boolean => pageIds.value.includes(id) || stateIds.value.includes(id)
const dirty = (ids: TweakId[]): boolean => ids.some((id) => !TWEAKS[id].isDefault())
const resetGroup = (ids: TweakId[]): void => ids.forEach((id) => TWEAKS[id].reset())
function resetAll(): void {
  resetGroup(Object.keys(TWEAKS) as TweakId[])
}

// The panel unmounts when closed; it comes back where it was scrolled to
// and with More open or folded as it was left.
const body = ref<HTMLElement>()
let scrolled = 0
const moreOpen = ref(false)
watch(body, (el) => el && requestAnimationFrame(() => (el.scrollTop = scrolled)), {
  flush: 'post'
})
function onScroll(e: Event): void {
  scrolled = (e.target as HTMLElement).scrollTop
}
</script>

<template>
  <!-- In the app's root (its theme applies) but outside the prototype's
       frame, so the screen simulator never scales it. -->
  <Teleport to="#app">
    <aside
      v-if="tuner.open"
      aria-label="UI tuner"
      class="proto-ui fixed top-14 right-4 bottom-4 z-[80] flex w-72 flex-col rounded-panel border border-border-default bg-card-background shadow-popover [-webkit-app-region:no-drag]"
    >
      <header class="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
        <h2 class="text-ui font-semibold">
          UI Playground
          <kbd
            class="ml-1.5 rounded-[5px] bg-secondary-background px-1.5 py-px font-sans text-[11px] font-normal text-subtle-foreground"
            >⌘.</kbd
          >
        </h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close" @click="tuner.open = false">
          <X :size="14" />
        </Button>
      </header>

      <div
        ref="body"
        class="mar-tuner-body flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4"
        @scroll.passive="onScroll"
      >
        <!-- Global: who is looking, where, and the colour. Applies everywhere. -->
        <section aria-label="Global" class="flex flex-col">
          <GroupHead title="Global" :changed="dirty(GLOBAL)" @reset="resetGroup(GLOBAL)" />
          <!-- Cloud's first screen is Home: before it, only the desktop app. -->
          <Row v-if="can.home" label="Surface">
            <Seg v-model="surface.id" label="Surface" :options="SURFACE_OPTIONS" />
          </Row>
          <!-- Desktop only: the proposed first launch, from its first screen. -->
          <Row v-if="can.design && !onCloud" label="Onboarding">
            <Button
              variant="secondary"
              size="sm"
              class="w-full"
              @click="showScreen((setupScreen = 'first'))"
              >Start onboarding</Button
            >
          </Row>
          <Row v-if="can.builds" label="Navigation">
            <Select v-model="marNav.id" :options="NAVS" class="w-full" />
          </Row>
          <Row label="Palette and theme">
            <div class="flex items-center gap-1.5">
              <Select v-model="palette.id" :options="paletteOptions" class="min-w-0 flex-1" />
              <Seg v-model="look.theme" compact label="Theme" :options="THEMES" />
            </div>
          </Row>
          <!-- The trio in empty states, step progress and loaders. -->
          <Row label="Brand motif">
            <Seg v-model="brandMotif.id" label="Brand motif" :options="BRAND_MOTIFS" />
          </Row>
        </section>

        <!-- States: the situation on screen (who, what's installed, signed
             in, how the page and the credits are doing). Each one shows
             only where it applies. -->
        <section aria-label="States" class="mt-6 flex flex-col">
          <GroupHead title="States" :changed="dirty(stateIds)" @reset="resetGroup(stateIds)" />
          <!-- The Deploy as API modal's states, first while it's open. -->
          <Row :show="shows('deployState')" label="Deploy state">
            <Select v-model="deployState" :options="DEPLOY_STATES" class="w-full" />
          </Row>
          <!-- Who is looking, and what is on this computer: two axes. A
               first-time user starts with no local install; a returning
               one may have none either (they work on Cloud). -->
          <Row label="User">
            <Seg
              label="User"
              :options="MAR_USERS"
              :model-value="marUser.user"
              @update:model-value="setUser"
            />
          </Row>
          <!-- Local builds: what's on this computer, and on Home whether
               it shows a Builds row. On Cloud (a browser) there is none. -->
          <Row :label="onCloud ? 'Local builds · none in a browser' : 'Local builds'">
            <Seg
              v-model="marUser.local"
              label="Local install"
              :options="MAR_LOCALS"
              :class="onCloud && 'pointer-events-none opacity-50'"
            />
          </Row>
          <Row :show="shows('homeBuilds')" label="Builds row on Home">
            <Seg v-model="homeBuilds.id" label="Builds row on Home" :options="HOME_BUILD_OPTIONS" />
          </Row>
          <Row :show="shows('appsStage')" label="Apps stage">
            <Seg v-model="appsStage.id" label="Apps stage" :options="APPS_STAGES" />
          </Row>
          <Row label="Account">
            <Seg v-model="account" label="Account" :options="ACCOUNTS" />
          </Row>
          <Row :show="shows('pageState')" label="Page state">
            <Seg v-model="pageState.id" label="Page state" :options="PAGE_STATES" />
          </Row>
          <Row :show="shows('credits')" label="Credits state">
            <Select v-model="creditsState.id" :options="CREDITS_STATES" class="w-full" />
          </Row>
        </section>

        <!-- This page: only what changes the screen on view now. -->
        <section aria-label="This page" class="mt-6 flex flex-col">
          <GroupHead
            title="This page"
            :note="pageName"
            :changed="dirty(pageIds)"
            @reset="resetGroup(pageIds)"
          />
          <Row :show="!pageIds.length">
            <p class="text-ui text-subtle-foreground">Nothing to tweak on this page</p>
          </Row>
          <Row :show="shows('homeBackground')" label="Background">
            <Select v-model="homeBackground.id" :options="BACKGROUNDS" class="w-full" />
          </Row>
          <Row :show="shows('firstRun')" label="First run">
            <Select v-model="firstRun.id" :options="FIRST_RUNS" class="w-full" />
          </Row>
          <Row :show="shows('exampleLook')" label="Examples">
            <Select v-model="exampleLook.id" :options="EXAMPLE_LOOKS" class="w-full" />
          </Row>
          <Row :show="shows('editorEntry')" label="Node editor entry">
            <Select v-model="editorEntry.id" :options="EDITOR_ENTRIES" class="w-full" />
          </Row>
          <Row :show="shows('templates')" label="Template cards">
            <Select v-model="templateStyle.id" :options="TEMPLATE_STYLES" class="w-full" />
          </Row>
          <Row :show="shows('buildCard')" label="Build card">
            <Select v-model="buildCard.id" :options="BUILD_CARDS" class="w-full" />
          </Row>
          <Row :show="shows('buildPage')" label="Build page">
            <Select v-model="buildPage.id" :options="BUILD_PAGES" class="w-full" />
          </Row>
          <Row :show="shows('cover')" label="Workflow cover">
            <Seg v-model="cover.id" label="Workflow cover" :options="COVERS" />
          </Row>
          <Row :show="shows('graph')" label="Graph look">
            <Seg v-model="graphStyle.id" label="Graph look" :options="GRAPH_STYLES" />
          </Row>
          <Row :show="shows('ports')"><NavOptionsTuner /></Row>
        </section>

        <!-- Local setup (mar/setup): the proposed install flow behind New
             Instance and "This computer", on Desktop. Still being defined. -->
        <section v-if="can.design && !onCloud" aria-label="Local setup" class="mt-6 flex flex-col">
          <GroupHead
            title="Local setup"
            note="New Instance"
            :changed="dirty(['localSetup'])"
            @reset="resetGroup(['localSetup'])"
          />
          <Row label="Flow">
            <Seg v-model="localSetup.mode" label="Flow" :options="LOCAL_SETUPS" />
          </Row>
          <template v-if="localSetup.mode === 'on'">
            <!-- M1 ships Builds only: no Home, no example workflows. -->
            <Row label="Scope">
              <Seg v-model="localSetup.scope" label="Scope" :options="SETUP_SCOPES" />
            </Row>
            <Row label="Jump to">
              <div class="grid grid-cols-2 gap-1" role="group" aria-label="Jump to">
                <button
                  v-for="o in SETUP_SCREENS"
                  :key="o.value"
                  type="button"
                  class="mar-jump"
                  :aria-pressed="setupScreen === o.value"
                  @click="showScreen((setupScreen = o.value))"
                >
                  {{ o.label }}
                </button>
              </div>
            </Row>
            <Row label="First screen cards">
              <Select v-model="localSetup.cards" :options="RUN_ON_CARDS" class="w-full" />
              <Button variant="ghost" size="sm" class="-ml-2 self-start" @click="canvas = true"
                >Compare cards</Button
              >
            </Row>
            <Row label="Operating system">
              <Select v-model="localSetup.os" :options="SETUP_OSES" class="w-full" />
            </Row>
            <Row v-if="localSetup.os !== 'mac'" label="Graphics">
              <Select v-model="localSetup.gpu" :options="SETUP_GPUS" class="w-full" />
            </Row>
            <Row label="This computer">
              <Select v-model="localSetup.machine" :options="MACHINES" class="w-full" />
            </Row>
            <Row>
              <Button variant="ghost" size="sm" class="-ml-2 self-start" @click="openSetup()"
                >Open the flow</Button
              >
            </Row>
          </template>
        </section>

        <!-- More: the screen simulator, the token knobs and the Figma
             explorations (p20/). Not the direction; only for reference. -->
        <details
          class="mar-tuner-more mt-6"
          :open="moreOpen"
          @toggle="moreOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary
            class="flex h-6 cursor-pointer list-none items-center gap-1.5 rounded-[5px] text-ui font-medium text-base-foreground outline-none focus-visible:ring-2 focus-visible:ring-border-focus [&::-webkit-details-marker]:hidden"
          >
            <span>More</span>
            <span class="font-normal text-subtle-foreground">· screen, surfaces, Figma</span>
            <span
              v-if="dirty(MORE)"
              class="size-1.5 shrink-0 rounded-full bg-muted-foreground"
              title="Changed from default"
              aria-label="Changed from default"
              role="img"
            />
            <button
              v-if="dirty(MORE)"
              type="button"
              class="ml-auto shrink-0 rounded-[5px] px-1 text-ui font-normal text-subtle-foreground outline-none hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
              @click.prevent.stop="resetGroup(MORE)"
            >
              Reset
            </button>
          </summary>
          <div class="flex flex-col pt-1">
            <Row label="Screen">
              <div class="flex gap-1.5">
                <Select v-model="screen.id" :options="screenOptions" class="min-w-0 flex-1" />
                <Select v-model="zoomPick" :options="zoomOptions" class="w-22 shrink-0" />
              </div>
            </Row>
            <Row label="Colour">
              <Select v-model="screen.display" :options="displayOptions" class="w-full" />
            </Row>
            <Row v-if="LOOKS.length > 1" label="Look">
              <Select v-model="marLook.id" :options="LOOKS" class="w-full" />
            </Row>
            <Row v-if="DIRECTIONS.length > 1" label="UI">
              <Seg v-model="look.direction" label="UI" :options="DIRECTIONS" />
            </Row>
            <Row v-for="k in KNOBS" :key="k.key" :label="k.label">
              <Seg
                :label="k.label"
                :options="k.options"
                :model-value="tuning[k.key]"
                @update:model-value="(v) => set(k.key, v)"
              />
            </Row>
            <Row label="Figma explorations">
              <div class="flex flex-col gap-2">
                <label v-for="r in P20_ROWS" :key="r.key" class="flex items-center gap-2">
                  <span class="w-24 shrink-0 truncate text-ui text-subtle-foreground">{{
                    r.label
                  }}</span>
                  <Select
                    :model-value="p20[r.key]"
                    :options="p20Options(r.key)"
                    class="min-w-0 flex-1"
                    @update:model-value="
                      (v: string) => ((p20 as Record<string, string>)[r.key] = v)
                    "
                  />
                </label>
              </div>
            </Row>
          </div>
        </details>

        <Button variant="ghost" size="sm" class="mt-5 -ml-2 self-start" @click="resetAll"
          >Reset all</Button
        >
      </div>
    </aside>
  </Teleport>
</template>

<style scoped>
.mar-tuner-body {
  scrollbar-width: thin;
}
</style>
