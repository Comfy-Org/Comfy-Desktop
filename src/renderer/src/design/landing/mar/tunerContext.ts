import { computed } from 'vue'
import { building, appsProto } from '../appFlow'
import { shownCredits } from '../account'
import { instances, isNewUser, proto } from '../useProto'
import { resetTuning, tuning } from './uiTuner'
import { surface } from './shell/surface'
import { marNav, marSideOn, marSidebarClosed } from './shell/marShell'
import { screen } from './screen'
// Graphite is applied on load.
import './palette'
import { cover, recentsCover } from './cover'
import { buildCard } from './pages/buildCard'
import { buildPage } from './build/buildPage'
import { syncPrevious } from './build/syncPrevious'
import { appToComfy, openAnswer } from './apps/appToComfy'
import { appRunsOn } from './apps/openAppInComfy'
import { assetsEverywhere } from './assets/assetsEverywhere'
import { folderDepth } from './assets/folderDepth'
import { assetFoldersShown } from './assets/assetFolderSwitch'
import { assetFolderLayout } from './assets/assetFolderLayout'
import { folderPicker } from './assets/folderPicker'
import { ratingStyle } from './assets/ratingStyle'
import { fullAssets } from './graph/fullAssets'
import { can } from '../milestones'
import { appsStage } from './apps/appsStage'
import { appExamplesAt, appPage } from './apps/appPage'
import { templateStyle } from './brand/templateStyle'
import { brandMotif } from './brand/brandMotif'
import { creditsState } from './credits'
import { p20 } from './p20/p20'
import { assetsTab, comfyLook } from './graph/comfyLook'
import { firstRun } from './firstRun'
import { exampleLook } from './userStates/exampleLook'
import { homeArcMix } from './userStates/homeArcMix'
import { editorEntry } from './userStates/editorEntry'
import { firstTime, marUser, setUser } from './userStates/userState'
import { pageState } from './pages/pageState'
import { marOwns } from './pages/owns'
import { marLook } from './looks/looks'
import { PORTS, ports, type Port } from './navOptions'
import { dep, scenarioPick } from './deploy/deployData'
import { localSetup } from './setup/setupFlow'
import { tplCase } from './templateModal/templateData'
import { homeTour } from './homeTour/homeTour'
import { createLook, DEFAULT_CREATE_LOOK } from './create/createLook'
import { createInput } from './create/createInput'
import { composerSearch } from './create/composerSearch'
import { agentOpens } from './create/agentOpens'
import { composerPos } from './create/composerPos'
import { createScreen } from './create/createScreen'
import { downloadScenario, templateDownloads } from './downloads/templateDownloads'
import { connection } from './offline/connection'
import { buildStart } from './build/comfyStart'
import { dlFooter } from './downloads/dlFooter'
import { homeLayout } from './home/homeLayout'
import { recentThumb } from './recentThumb'
import { homeIdea } from './home/homeIdeas'

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
  // What an app can do by stage: only on the app's own screen.
  appsStage: computed(() => can.value.exploreApps && !!appsProto.front),
  // How an app's page looks: on the app's own screen too.
  appPage: computed(
    () => can.value.exploreApps && (!!appsProto.front || proto.page.startsWith('app:'))
  ),
  // Where its examples sit: on the app's own screen, in the Hub editor.
  appExamplesAt: computed(() => can.value.exploreApps && !!appsProto.front),
  appToComfy: computed(() => can.value.exploreApps && !!appsProto.front),
  openAnswer: computed(() => can.value.exploreApps && !!appsProto.front),
  appRunsOn: computed(() => can.value.exploreApps && !!appsProto.front),
  firstRun: onFirstRun,
  // Examples show in the Original first run and on a first-time Home with
  // a build, in Recently used's place.
  exampleLook: computed(
    () => onHome.value && firstTime.value && (!onFirstRun.value || firstRun.id === 'original')
  ),
  // Milestone 3's Home: how the arc shows apps and workflows.
  homeArcMix: computed(() => onHome.value && can.value.explore),
  homeLayout: computed(
    () => onHome.value && can.value.exploreApps && (!onFirstRun.value || firstRun.id === 'original')
  ),
  recentThumb: computed(
    () => (onHome.value && homeLayout.id === 'recents') || createLook.id === 'V15'
  ),
  homeIdeas: computed(
    () => onHome.value && can.value.exploreApps && !onFirstRun.value && homeLayout.id === 'recents'
  ),
  // The node editor's way in, under the examples of the Original first run.
  editorEntry: computed(() => onFirstRun.value && firstRun.id === 'original'),
  // Template cards: Explore and Favorites.
  templates: computed(() => inShell.value && ['explore', 'favorites'].includes(proto.page)),
  // Rows or photos on the Builds page (milestone 1 shows only rows).
  buildCard: computed(
    () =>
      inShell.value && proto.milestone >= 3 && ['environments', 'instances'].includes(proto.page)
  ),
  // A build's page, in the Builds milestone (later ones keep their tabs).
  buildPage: computed(
    () => inShell.value && proto.page.startsWith('environment:') && !can.value.breadcrumb
  ),
  // Past the Builds milestone: the Builds list and a build's pages.
  syncPrevious: computed(
    () =>
      inShell.value &&
      can.value.breadcrumb &&
      (['environments', 'instances'].includes(proto.page) || proto.page.startsWith('environment:'))
  ),
  // Workflow cards with a cover: a build's page, Workflows and Home's recents.
  cover: computed(
    () =>
      inShell.value &&
      (proto.page.startsWith('environment:') ||
        proto.page === 'workflows' ||
        (proto.page === 'overview' && !can.value.onboarding))
  ),
  recentsCover: computed(() => onHome.value && can.value.onboarding),
  homeTour: computed(() => onHome.value && can.value.onboarding),
  createLook: computed(() => can.value.onboarding && createScreen.open),
  pageState: computed(() => inShell.value && (LIBRARY.includes(proto.page) || marOwns(proto.page))),
  // Desktop's Assets page.
  assetsEverywhere: computed(() => inShell.value && proto.page === 'assets'),
  // The star on a card: Desktop's Assets page and ComfyUI's tab.
  rating: computed(() => (inShell.value && proto.page === 'assets') || assetsTab.open),
  // Where the folder is picked: Desktop's Assets page.
  folderPicker: computed(() => inShell.value && proto.page === 'assets'),
  // ComfyUI's Assets tab, where folders live.
  assetFolders: computed(
    () => (inShell.value && proto.page === 'assets') || (assetsTab.open && assetsTab.on)
  ),
  assetFolderLayout: computed(
    () => inShell.value && proto.page === 'assets' && can.value.onboarding
  ),
  folderDepth: computed(
    () =>
      (assetFoldersShown.id === 'on' &&
        ((inShell.value && proto.page === 'assets') || (assetsTab.open && assetsTab.on))) ||
      (assetFolderLayout.id === 'tree' &&
        inShell.value &&
        proto.page === 'assets' &&
        can.value.onboarding)
  ),
  // ComfyUI (Proposal): where the Assets panel's expand button goes.
  fullAssets: computed(() => inGraph.value && comfyLook.id === 'proposal'),
  // Credits: the sidebar foot; Tabs has no sidebar.
  credits: computed(() => sidebarShown.value && !!shownCredits.value && marNav.id !== 'tabs'),
  graph: inGraph,
  // The Deploy as API modal (deploy/MarDeployModal.vue), while it's open.
  deployState: computed(() => Boolean(proto.deploying)),
  // The template modal (templateModal/MarTemplateModal.vue), while it's open.
  wfCase: computed(() => proto.detail?.kind === 'template' && !can.value.onboarding),
  dlFooter: computed(() => can.value.onboarding && proto.detail?.kind === 'template'),
  downloadScenario: computed(
    () =>
      can.value.onboarding &&
      (proto.detail?.kind === 'template' ||
        (inShell.value && proto.page === 'explore') ||
        templateDownloads.list.length > 0)
  ),
  connection: computed(() => inShell.value || proto.tabs.length > 0),
  buildStart: computed(() => inShell.value || proto.tabs.length > 0),
  tplCases: computed(
    () =>
      can.value.onboarding &&
      (proto.detail?.kind === 'template' || (inShell.value && proto.page === 'explore'))
  ),
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
  contrast: 'default'
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
  brandMotif: one(brandMotif, 'off'),
  appsStage: one(appsStage, 'm1'),
  appPage: one(appPage, 'hub'),
  appExamplesAt: one(appExamplesAt, 'tabs'),
  appToComfy: one(appToComfy, 'off'),
  openAnswer: one(openAnswer, 'auto'),
  appRunsOn: one(appRunsOn, 'cloud'),
  firstRun: one(firstRun, 'original'),
  exampleLook: one(exampleLook, 'arc'),
  homeArcMix: one(homeArcMix, 'tabs'),
  homeLayout: one(homeLayout, 'recents'),
  recentThumb: one(recentThumb, 'runsOn'),
  homeIdeaThumbs: one(homeIdea('thumbs').store, 'off'),
  homeIdeaHeaders: one(homeIdea('headers').store, 'off'),
  homeIdeaCleanCards: one(homeIdea('cleanCards').store, 'off'),
  homeIdeaCompactRecents: one(homeIdea('compactRecents').store, 'off'),
  homeIdeaSmallGreeting: one(homeIdea('smallGreeting').store, 'off'),
  editorEntry: one(editorEntry, 'rows'),
  templates: one(templateStyle, 'photo'),
  // The milestone picks the cover (cover.ts): the canvas, then the image.
  cover: {
    isDefault: () => cover.id === (can.value.projects ? 'output' : 'canvas'),
    reset: () => (cover.id = can.value.projects ? 'output' : 'canvas')
  },
  recentsCover: one(recentsCover, 'generic'),
  homeTour: one(homeTour, 'auto'),
  createLook: one(createLook, DEFAULT_CREATE_LOOK),
  createInput: one(createInput, 'agent'),
  composerSearch: one(composerSearch, 'smart'),
  agentOpens: one(agentOpens, 'create'),
  composerPos: one(composerPos, 'bottom'),
  buildCard: one(buildCard, 'rows'),
  buildPage: one(buildPage, 'production'),
  syncPrevious: one(syncPrevious, 'off'),
  assetsEverywhere: one(assetsEverywhere, 'off'),
  assetFolders: one(assetFoldersShown, 'off'),
  assetFolderLayout: one(assetFolderLayout, 'off'),
  rating: one(ratingStyle, 'stars'),
  folderPicker: one(folderPicker, 'filters'),
  folderDepth: one(folderDepth, 'few'),
  fullAssets: one(fullAssets, 'home'),
  pageState: one(pageState, 'live'),
  credits: one(creditsState, 'active'),
  wfCase: one(tplCase, 'catalog'),
  downloadScenario: one(downloadScenario, 'normal'),
  dlFooter: one(dlFooter, 'button'),
  connection: one(connection, 'online'),
  buildStart: one(buildStart, 'starts'),
  // The modal opens on Configure (or Needs upload for an unreleased version).
  deployState: {
    isDefault: () => !proto.deploying || ['configure', 'needs-publish'].includes(dep.scenario),
    reset: () => {
      if (proto.deploying) scenarioPick.want = 'configure'
    }
  },
  comfyLook: one(comfyLook, 'proposal'),
  ports: {
    isDefault: () => PORTS.every((p) => !ports[p.key]),
    reset: () => PORTS.forEach((p) => (ports[p.key] = false))
  },
  // Local setup: Today's toast until the proposal is switched on; the
  // proposal opens on the one-click install, as setupFlow.ts and the link do.
  localSetup: {
    isDefault: () =>
      localSetup.mode === 'off' &&
      localSetup.machine === 'ready' &&
      localSetup.cards === 'glow' &&
      localSetup.scope === 'next' &&
      localSetup.onboarding === 'oneclick' &&
      localSetup.after === 'ready' &&
      localSetup.card === 'top' &&
      localSetup.os === 'mac' &&
      localSetup.gpu === 'nvidia' &&
      localSetup.nodes === 'off',
    reset: () =>
      Object.assign(localSetup, {
        mode: 'off',
        machine: 'ready',
        cards: 'glow',
        scope: 'next',
        onboarding: 'oneclick',
        after: 'ready',
        card: 'top',
        os: 'mac',
        gpu: 'nvidia',
        nodes: 'off'
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
