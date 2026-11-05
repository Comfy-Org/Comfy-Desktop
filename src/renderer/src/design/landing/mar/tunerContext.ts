import { computed } from 'vue'
import { look } from '../look'
import { building, appsProto } from '../appFlow'
import { shownCredits } from '../account'
import { instances, isNewUser, proto } from '../useProto'
import { resetTuning, tuning } from './uiTuner'
import { surface, onCloud } from './shell/surface'
import { homeBackground, marNav, marSideOn, marSidebarClosed } from './shell/marShell'
import { screen } from './screen'
import { palette } from './palette'
import { cover } from './cover'
import { buildCard } from './pages/buildCard'
import { buildPage } from './build/buildPage'
import { can } from '../milestones'
import { homeBuilds } from './homeBuilds'
import { appsStage } from './apps/appsStage'
import { templateStyle } from './brand/templateStyle'
import { brandMotif } from './brand/brandMotif'
import { creditsState } from './credits'
import { p20 } from './p20/p20'
import { graphStyle } from './graph/graphStyle'
import { firstRun } from './firstRun'
import { exampleLook } from './userStates/exampleLook'
import { editorEntry } from './userStates/editorEntry'
import { firstTime, marUser, setUser } from './userStates/userState'
import { pageState } from './pages/pageState'
import { marOwns } from './pages/owns'
import { marLook } from './looks/looks'
import { PORTS, ports, type Port } from './navOptions'
import { dep, scenarioPick } from './deploy/deployData'
import { localSetup } from './setup/setupFlow'

/**
 * UI Playground: when each tweak changes what's on screen, so the panel
 * (UiTuner.vue) only offers it then. Each predicate follows the code that
 * reads the tweak; keep them in step when a tweak moves to a new place.
 */

// Where the window is: a build's graph, an app opened full screen, or the
// app shell (sidebar and pages) with Home and the libraries.
export const inGraph = computed(() => !appsProto.front && proto.activeTab !== 'home')
export const inShell = computed(
  () => proto.activeTab === 'home' && !appsProto.front && proto.viewAs !== 'client'
)
const sidebarShown = computed(() => inShell.value && !building.value && !marSidebarClosed.value)

export const onHome = computed(() => inShell.value && proto.page === 'overview')
// A Figma layout (More › Figma explorations) replaces the returning Home.
const noLocal = computed(() => !instances.value.some((i) => i.kind === 'local'))
/** First-time user before any local install: the first-run Home (MarHomeV10). */
export const onFirstRun = computed(() => onHome.value && firstTime.value && noLocal.value)

const LIBRARY = ['explore', 'workflows', 'apps', 'assets', 'projects', 'spaces', 'favorites']

/** The predicates, one per tweak that depends on the screen. */
export const when = {
  homeBackground: onHome,
  homeBuilds: computed(() => onHome.value && !onFirstRun.value && !onCloud.value),
  // What an app can do by stage: only on the app's own screen.
  appsStage: computed(() => can.value.exploreApps && !!appsProto.front),
  firstRun: onFirstRun,
  // Examples show in the Original first run and on a first-time Home with
  // a build, in Recently used's place.
  exampleLook: computed(
    () => onHome.value && firstTime.value && (!onFirstRun.value || firstRun.id === 'original')
  ),
  // The node editor's way in, under the examples of the Original first run.
  editorEntry: computed(() => onFirstRun.value && firstRun.id === 'original'),
  // Template cards: Explore and Favorites.
  templates: computed(() => inShell.value && ['explore', 'favorites'].includes(proto.page)),
  // The cards on the Builds page (milestone 1 shows only rows).
  buildCard: computed(
    () =>
      inShell.value && proto.milestone >= 3 && ['environments', 'instances'].includes(proto.page)
  ),
  // A build's page, in the Builds milestone (later ones keep their tabs).
  buildPage: computed(
    () => inShell.value && proto.page.startsWith('environment:') && !can.value.breadcrumb
  ),
  // Workflow cards with a cover: a build's page, Workflows and Home's recents.
  cover: computed(
    () =>
      inShell.value &&
      (proto.page.startsWith('environment:') || ['workflows', 'overview'].includes(proto.page))
  ),
  pageState: computed(() => inShell.value && (LIBRARY.includes(proto.page) || marOwns(proto.page))),
  // Credits: the sidebar foot; Tabs has no sidebar.
  credits: computed(() => sidebarShown.value && !!shownCredits.value && marNav.id !== 'tabs'),
  graph: inGraph,
  // The Deploy as API modal (deploy/MarDeployModal.vue), while it's open.
  deployState: computed(() => Boolean(proto.deploying)),
  // Nav options (NavOptionsTuner.vue): each switch acts on the Floating
  // sidebar and the Tabs bar, each in its own situation.
  ports: computed(() => inShell.value && (marSideOn.value || marNav.id === 'tabs'))
}

export const PORT_WHEN: Record<Port, () => boolean> = {
  navAccount: () => !proto.signedIn,
  navDocs: () => proto.mode === 'build',
  firstRunNav: () => isNewUser.value
}
export const shownPorts = computed(() =>
  when.ports.value ? PORTS.filter((p) => PORT_WHEN[p.key]()) : []
)

const PAGE_NAMES: Record<string, string> = {
  overview: 'Home',
  explore: 'Explore',
  tutorials: 'Learn',
  workflows: 'Workflows',
  apps: 'Apps',
  assets: 'Assets',
  environments: 'Builds',
  instances: 'Builds',
  projects: 'Projects',
  spaces: 'Spaces',
  favorites: 'Favorites',
  settings: 'Settings',
  agent: 'Agent',
  'build-overview': 'Build · Overview',
  deployments: 'Deployments',
  router: 'Models',
  logs: 'Logs',
  keys: 'API keys'
}
const PREFIXES: [string, string][] = [
  ['project:', 'Project'],
  ['space:', 'Space'],
  ['environment:', 'Build'],
  ['deployment:', 'Deployment'],
  ['app:', 'App']
]

/** The current screen's name, for "This page · …". */
export const pageName = computed(() => {
  if (appsProto.front) return 'App'
  if (inGraph.value) return 'Graph editor'
  const p = proto.page
  if (onHome.value && onFirstRun.value) return 'Home · first run'
  const named = PAGE_NAMES[p] ?? PREFIXES.find(([k]) => p.startsWith(k))?.[1]
  if (named) return named
  return p.charAt(0).toUpperCase() + p.slice(1).replace(/-/g, ' ')
})

/** A tweak's default (what it loads with when nothing is saved) and how to
 *  go back to it. The defaults copy the stores' own; Reset never changes
 *  them. */
export interface Tweak {
  isDefault: () => boolean
  reset: () => void
}
const TUNING_DEFAULTS = {
  radius: 'default',
  contrast: 'default',
  borders: 'none'
}
const P20_DEFAULTS: Record<string, string> = {
  recent: 'cards',
  spaces: 'plain',
  news: 'banner',
  builds: 'off',
  pulse: 'off',
  panel: 'none',
  density: 'default',
  rail: 'plain'
}
const one = <T extends { id: string }>(s: T, def: T['id']): Tweak => ({
  isDefault: () => s.id === def,
  reset: () => (s.id = def)
})

export const TWEAKS = {
  user: {
    isDefault: () => marUser.user === 'returning' && marUser.local === 'several',
    reset: () => setUser('returning')
  },
  account: {
    isDefault: () => proto.signedIn,
    reset: () => (proto.signedIn = true)
  },
  surface: one(surface, 'desktop'),
  nav: one(marNav, 'panels'),
  palette: one(palette, 'graphite'),
  theme: { isDefault: () => look.theme === 'dark', reset: () => (look.theme = 'dark') },
  brandMotif: one(brandMotif, 'off'),
  homeBackground: one(homeBackground, 'spotlight'),
  homeBuilds: one(homeBuilds, 'on'),
  appsStage: one(appsStage, 'm1'),
  firstRun: one(firstRun, 'original'),
  exampleLook: one(exampleLook, 'arc'),
  editorEntry: one(editorEntry, 'rows'),
  templates: one(templateStyle, 'photo'),
  cover: one(cover, 'gradient'),
  buildCard: one(buildCard, 'photos'),
  buildPage: one(buildPage, 'production'),
  pageState: one(pageState, 'live'),
  credits: one(creditsState, 'active'),
  // The modal opens on Configure (or Needs upload for an unreleased version).
  deployState: {
    isDefault: () => !proto.deploying || ['configure', 'needs-publish'].includes(dep.scenario),
    reset: () => {
      if (proto.deploying) scenarioPick.want = 'configure'
    }
  },
  graph: one(graphStyle, 'glass'),
  ports: {
    isDefault: () => PORTS.every((p) => !ports[p.key]),
    reset: () => PORTS.forEach((p) => (ports[p.key] = false))
  },
  // Local setup: Today's toast until the proposal is switched on.
  localSetup: {
    isDefault: () =>
      localSetup.mode === 'off' &&
      localSetup.machine === 'ready' &&
      localSetup.cards === 'glow' &&
      localSetup.scope === 'm1' &&
      localSetup.os === 'mac' &&
      localSetup.gpu === 'nvidia',
    reset: () =>
      Object.assign(localSetup, {
        mode: 'off',
        machine: 'ready',
        cards: 'glow',
        scope: 'm1',
        os: 'mac',
        gpu: 'nvidia'
      })
  },
  look: one(marLook, 'current'),
  knobs: {
    isDefault: () =>
      Object.entries(TUNING_DEFAULTS).every(
        ([k, v]) => (tuning as Record<string, string>)[k] === v
      ),
    reset: resetTuning
  },
  screen: {
    isDefault: () => screen.id === 'fit' && screen.zoom === 1 && screen.display === 'true',
    reset: () => Object.assign(screen, { id: 'fit', zoom: 1, display: 'true' })
  },
  p20: {
    isDefault: () =>
      Object.entries(P20_DEFAULTS).every(([k, v]) => (p20 as Record<string, string>)[k] === v),
    reset: () => Object.assign(p20, P20_DEFAULTS)
  }
} satisfies Record<string, Tweak>
export type TweakId = keyof typeof TWEAKS
