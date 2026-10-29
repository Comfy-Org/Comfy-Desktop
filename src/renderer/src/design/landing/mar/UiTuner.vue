<script setup lang="ts">
import { computed } from 'vue'
import { Moon, Sun, X } from 'lucide-vue-next'
import Button from '../ui/Button.vue'
import { DIRECTIONS, look } from '../look'
import { KNOBS, resetTuning, tuner, tuning, type Tuning } from './uiTuner'
import { isMariana, proposal, PROPOSALS } from './proposal'
import { onCloud, SURFACES, surface } from './shell/surface'
import { homeBackground, marNav, type HomeBackground, type MarNav } from './shell/marShell'
import { DISPLAYS, SCREENS, ZOOMS, screen } from './screen'
import Select from '../ui/Select.vue'
import { PALETTES, palette } from './palette'
import { MODE_STYLES, modeStyle } from './modes/modeStyle'
import { COVERS, cover } from './cover'
import { HOME_BUILDS, homeBuilds } from './homeBuilds'
import { TEMPLATE_STYLES, templateStyle } from './brand/templateStyle'
import { CREDITS_STATES, creditsState } from './credits'
import { P20, p20 } from './p20/p20'
import { GRAPH_STYLES, graphStyle } from './graph/graphStyle'
import { FIRST_RUNS, firstRun } from './firstRun'
import { MAR_LOCALS, MAR_USERS, marUser, setUser } from './userStates/userState'
import { PAGE_STATES, pageState } from './pages/pageState'
import { LOOKS, marLook } from './looks/looks'
import MarLookFx from './looks/MarLookFx.vue'
import PabloPortsTuner from './PabloPortsTuner.vue'

/** The UI tuner panel (Prototype menu › UI Playground): whose proposal
 *  (Pablo's branch as it is, or Mar's draft) and the UI to start from,
 *  then the knobs, applied live. */
const NAVS: { value: MarNav; label: string }[] = [
  { value: 'classic', label: 'Original' },
  { value: 'floating', label: 'Floating · a card' },
  { value: 'tabs', label: '08 · Tabs · a bar on top' },
  { value: 'panels', label: 'Panels · sidebar and page as two cards' }
]
const BACKGROUNDS: { value: HomeBackground; label: string }[] = [
  { value: 'spotlight', label: 'Spotlight · soft light and film grain' },
  { value: 'bloom', label: 'Latent bloom · colour out of grain' },
  { value: 'output', label: 'Latest output · your last result, blurred' }
]

function reset(): void {
  resetTuning()
  marNav.id = 'classic'
  homeBackground.id = 'spotlight'
  homeBuilds.id = 'off'
  setUser('returning')
  palette.id = 'void'
}

const paletteOptions = PALETTES.map((p) => ({ value: p.id, label: p.label }))

const THEMES = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun }
] as const
const P20_ROWS: { key: keyof typeof P20; label: string }[] = [
  { key: 'homeLayout', label: 'Home layout' },
  { key: 'recent', label: 'Recently used' },
  { key: 'news', label: "What's new" },
  { key: 'spaces', label: 'Spaces' },
  { key: 'builds', label: 'Builds' },
  { key: 'pulse', label: 'Usage strip' },
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
</script>

<template>
  <!-- In the app's root (its theme applies) but outside the prototype's
       frame, so the screen simulator never scales it. -->
  <Teleport to="#app">
    <aside
      v-if="tuner.open"
      aria-label="UI tuner"
      class="proto-ui fixed top-14 right-4 bottom-4 z-50 flex w-72 flex-col gap-4 overflow-y-auto rounded-panel border border-border-default bg-card-background p-4 shadow-popover [-webkit-app-region:no-drag]"
    >
      <header class="flex items-center justify-between">
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

      <div class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">Proposal</span>
        <div class="mar-seg flex gap-1 rounded-control bg-secondary-background p-0.5">
          <button
            v-for="p in PROPOSALS"
            :key="p.value"
            type="button"
            :aria-pressed="proposal.id === p.value"
            :class="[
              'h-7 flex-1 rounded-[7px] px-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              proposal.id === p.value
                ? 'bg-secondary-background-hover font-medium text-base-foreground'
                : 'text-muted-foreground hover:text-base-foreground'
            ]"
            @click="proposal.id = p.value"
          >
            {{ p.label }}
          </button>
        </div>
      </div>

      <!-- Mar's proposal: Surface on its own row; palette and light/dark
           share the next one, since both set the colour. -->
      <div v-if="isMariana" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">Surface</span>
        <div class="flex items-center gap-1.5">
          <div
            class="mar-seg flex min-w-0 flex-1 gap-1 rounded-control bg-secondary-background p-0.5"
          >
            <button
              v-for="sf in SURFACES"
              :key="sf.value"
              type="button"
              :aria-pressed="surface.id === sf.value"
              :class="[
                'h-7 min-w-0 flex-1 truncate rounded-[7px] px-1.5 text-ui outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                surface.id === sf.value
                  ? 'bg-secondary-background-hover font-medium text-base-foreground'
                  : 'text-muted-foreground hover:text-base-foreground'
              ]"
              @click="surface.id = sf.value"
            >
              {{ sf.value === 'desktop' ? 'Desktop' : 'Cloud' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Who is looking, and what is on this computer: two axes. A
           first-time user starts with no local install; a returning one
           may have none either (they work on Cloud). -->
      <div v-if="isMariana" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">User</span>
        <div class="mar-seg flex gap-1 rounded-control bg-secondary-background p-0.5">
          <button
            v-for="u in MAR_USERS"
            :key="u.value"
            type="button"
            :aria-pressed="marUser.user === u.value"
            :class="[
              'h-7 flex-1 rounded-[7px] px-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              marUser.user === u.value
                ? 'bg-secondary-background-hover font-medium text-base-foreground'
                : 'text-muted-foreground hover:text-base-foreground'
            ]"
            @click="setUser(u.value)"
          >
            {{ u.label }}
          </button>
        </div>
      </div>

      <div v-if="isMariana" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground"
          >Local install<template v-if="onCloud"> · none in a browser</template></span
        >
        <div class="mar-seg flex gap-1 rounded-control bg-secondary-background p-0.5">
          <button
            v-for="l in MAR_LOCALS"
            :key="l.value"
            type="button"
            :aria-pressed="marUser.local === l.value"
            :disabled="onCloud"
            :class="[
              onCloud && 'opacity-50',
              'h-7 flex-1 rounded-[7px] px-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              marUser.local === l.value
                ? 'bg-secondary-background-hover font-medium text-base-foreground'
                : 'text-muted-foreground hover:text-base-foreground'
            ]"
            @click="marUser.local = l.value"
          >
            {{ l.label }}
          </button>
        </div>
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">{{
          isMariana ? 'Palette and theme' : 'Theme'
        }}</span>
        <div class="flex items-center gap-1.5">
          <Select
            v-if="isMariana"
            v-model="palette.id"
            :options="paletteOptions"
            class="min-w-0 flex-1"
          />
          <div
            class="mar-seg ml-auto flex shrink-0 gap-0.5 rounded-control bg-secondary-background p-0.5"
          >
            <button
              v-for="t in THEMES"
              :key="t.value"
              type="button"
              :aria-pressed="look.theme === t.value"
              :aria-label="t.label"
              :title="t.label"
              :class="[
                'inline-flex h-7 w-9 items-center justify-center rounded-[7px] outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                look.theme === t.value
                  ? 'bg-secondary-background-hover text-base-foreground'
                  : 'text-muted-foreground hover:text-base-foreground'
              ]"
              @click="look.theme = t.value"
            >
              <component :is="t.icon" :size="14" />
            </button>
          </div>
        </div>
      </div>

      <div v-if="isMariana" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">Look</span>
        <Select v-model="marLook.id" :options="LOOKS" class="w-full" />
      </div>

      <!-- Mar's pages: show any page Live, Loading, Empty or offline. -->
      <div v-if="isMariana" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">Page state</span>
        <div class="mar-seg flex gap-1 rounded-control bg-secondary-background p-0.5">
          <button
            v-for="ps in PAGE_STATES"
            :key="ps.value"
            type="button"
            :aria-pressed="pageState.id === ps.value"
            :class="[
              'h-7 min-w-0 flex-1 truncate rounded-[7px] px-1.5 text-ui outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              pageState.id === ps.value
                ? 'bg-secondary-background-hover font-medium text-base-foreground'
                : 'text-muted-foreground hover:text-base-foreground'
            ]"
            @click="pageState.id = ps.value"
          >
            {{ ps.label }}
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">Screen</span>
        <div class="flex gap-1.5">
          <Select v-model="screen.id" :options="screenOptions" class="min-w-0 flex-1" />
          <Select v-model="zoomPick" :options="zoomOptions" class="w-22 shrink-0" />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">Colour</span>
        <Select v-model="screen.display" :options="displayOptions" class="w-full" />
      </div>

      <div v-if="isMariana" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">Navigation</span>
        <Select v-model="marNav.id" :options="NAVS" class="w-full" />
      </div>

      <div v-if="isMariana" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">Mode switch</span>
        <Select v-model="modeStyle.id" :options="MODE_STYLES" class="w-full" />
      </div>

      <div v-if="isMariana" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">Templates</span>
        <Select v-model="templateStyle.id" :options="TEMPLATE_STYLES" class="w-full" />
      </div>

      <div v-if="isMariana" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">Credits state</span>
        <Select v-model="creditsState.id" :options="CREDITS_STATES" class="w-full" />
      </div>

      <div v-if="isMariana" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">Workflow cover</span>
        <div class="mar-seg flex gap-1 rounded-control bg-secondary-background p-0.5">
          <button
            v-for="c in COVERS"
            :key="c.value"
            type="button"
            :aria-pressed="cover.id === c.value"
            :class="[
              'h-7 flex-1 rounded-[7px] px-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              cover.id === c.value
                ? 'bg-secondary-background-hover font-medium text-base-foreground'
                : 'text-muted-foreground hover:text-base-foreground'
            ]"
            @click="cover.id = c.value"
          >
            {{ c.label }}
          </button>
        </div>
      </div>

      <div v-if="isMariana" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">Home background</span>
        <Select v-model="homeBackground.id" :options="BACKGROUNDS" class="w-full" />
      </div>

      <div v-if="isMariana" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">Build on Home</span>
        <div class="mar-seg flex gap-1 rounded-control bg-secondary-background p-0.5">
          <button
            v-for="b in HOME_BUILDS"
            :key="b.value"
            type="button"
            :aria-pressed="homeBuilds.id === b.value"
            :class="[
              'h-7 flex-1 rounded-[7px] px-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              homeBuilds.id === b.value
                ? 'bg-secondary-background-hover font-medium text-base-foreground'
                : 'text-muted-foreground hover:text-base-foreground'
            ]"
            @click="homeBuilds.id = b.value"
          >
            {{ b.label }}
          </button>
        </div>
      </div>

      <PabloPortsTuner v-if="isMariana" />

      <div v-if="isMariana" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">First run · first-time, no local install</span>
        <Select v-model="firstRun.id" :options="FIRST_RUNS" class="w-full" />
      </div>

      <div v-if="DIRECTIONS.length > 1" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">UI</span>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="d in DIRECTIONS"
            :key="d.value"
            type="button"
            :aria-pressed="look.direction === d.value"
            :class="[
              'h-7 rounded-control px-2.5 text-ui outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              look.direction === d.value
                ? 'bg-secondary-background-hover font-medium text-base-foreground'
                : 'text-muted-foreground hover:bg-secondary-background hover:text-base-foreground'
            ]"
            @click="look.direction = d.value"
          >
            {{ d.label }}
          </button>
        </div>
      </div>

      <div v-for="k in KNOBS" :key="k.key" class="flex flex-col gap-1.5">
        <span class="text-ui text-subtle-foreground">{{ k.label }}</span>
        <div class="mar-seg flex gap-1 rounded-control bg-secondary-background p-0.5">
          <button
            v-for="o in k.options"
            :key="o.value"
            type="button"
            :aria-pressed="tuning[k.key] === o.value"
            :class="[
              'h-7 flex-1 rounded-[7px] px-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              tuning[k.key] === o.value
                ? 'bg-secondary-background-hover font-medium text-base-foreground'
                : 'text-muted-foreground hover:text-base-foreground'
            ]"
            @click="set(k.key, o.value)"
          >
            {{ o.label }}
          </button>
        </div>
      </div>

      <!-- The graph editor is its own thing, below the Home and app tweaks. -->
      <div v-if="isMariana" class="mt-2 flex flex-col gap-3 border-t border-border-default pt-4">
        <span class="text-ui font-medium text-base-foreground">Graph editor</span>
        <div v-if="isMariana" class="flex flex-col gap-1.5">
          <span class="text-ui text-subtle-foreground">Look</span>
          <div class="mar-seg flex gap-1 rounded-control bg-secondary-background p-0.5">
            <button
              v-for="g in GRAPH_STYLES"
              :key="g.value"
              type="button"
              :aria-pressed="graphStyle.id === g.value"
              :class="[
                'h-7 flex-1 rounded-[7px] px-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                graphStyle.id === g.value
                  ? 'bg-secondary-background-hover font-medium text-base-foreground'
                  : 'text-muted-foreground hover:text-base-foreground'
              ]"
              @click="graphStyle.id = g.value"
            >
              {{ g.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Figma explorations (p20/): kept as secondary options, folded
           away at the end. Not the direction; only for reference. -->
      <details v-if="isMariana" class="mar-tuner-more">
        <summary class="cursor-pointer text-ui text-subtle-foreground">
          More options · Figma explorations
        </summary>
        <div class="mt-2.5 flex flex-col gap-2">
          <label v-for="r in P20_ROWS" :key="r.key" class="flex items-center gap-2">
            <span class="w-24 shrink-0 text-ui text-subtle-foreground">{{ r.label }}</span>
            <Select
              :model-value="p20[r.key]"
              :options="p20Options(r.key)"
              class="min-w-0 flex-1"
              @update:model-value="(v: string) => ((p20 as Record<string, string>)[r.key] = v)"
            />
          </label>
        </div>
      </details>

      <Button variant="ghost" size="sm" class="self-start" @click="reset">Reset</Button>
    </aside>
  </Teleport>
  <!-- Look (looks/): the shader and pointer light, only while a look needs them. -->
  <MarLookFx v-if="isMariana" />
</template>
