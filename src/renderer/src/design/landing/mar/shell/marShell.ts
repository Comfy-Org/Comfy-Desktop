import { computed, reactive, watch } from 'vue'
import { proto } from '../../useProto'
import { can } from '../../milestones'
import { active } from '../marParts'
import { mock } from '../assets/mock'
import { spaceById } from '../../spaces'

/**
 * Mar's shell (Figma "Exploration 01 · Cinema hero"): the sidebar floats
 * over the page with a blur and can be closed; library pages sit under a
 * blurred photo.
 *
 * `data-mar-shell` and `data-mar-ui` on <html> scope the shell's stylesheets
 * (marShell.css and friends). All of them follow `can.design`: Milestone 0
 * is Desktop as it ships, on the same page, so it must not pick these up.
 */

const KEY = 'comfy.design.mar.sidebar'

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'closed'
  } catch {
    // Storage blocked: open by default.
    return true
  }
}

/** The sidebar is open by default; the choice is saved per browser. */
export const marShell = reactive({ open: load() })

watch(
  () => marShell.open,
  (open) => {
    try {
      localStorage.setItem(KEY, open ? 'open' : 'closed')
    } catch {
      // Storage blocked: the choice lasts for this window only.
    }
  }
)

/** Mar's floating sidebar (an earlier shell, kept for comparison). */
export const marShellOn = computed(() => can.value.design && active.value.shell === 'mar')

watch(
  marShellOn,
  (on) => {
    if (on) document.documentElement.dataset.marShell = 'on'
    else delete document.documentElement.dataset.marShell
  },
  { immediate: true }
)

/** Mar's navigation (UI Playground › Navigation): Mar's sidebar attached
 *  to the window or floating (MarSidebar.vue), the dock at the bottom
 *  (MarDock.vue), a bar on top, or Floating panels. Same places in all. */
export type MarNav = 'sidebar' | 'floating' | 'dock' | 'tabs' | 'panels'
// v3: Floating panels (sidebar and page as two cards) is the default
// (Pablo/Mar, Oct 30). The dock and Original are no longer offered; a
// stored pick of either falls back to the default.
const NAV_KEY = 'comfy.design.mar.nav.v3'
function loadNav(): { id: MarNav; collapsed: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(NAV_KEY) ?? '{}')
    const id: MarNav = ['floating', 'tabs', 'panels'].includes(v.id) ? v.id : 'panels'
    return { id, collapsed: Boolean(v.collapsed) }
  } catch {
    return { id: 'panels', collapsed: false }
  }
}
export const marNav = reactive(loadNav())
watch(
  () => ({ ...marNav }),
  (v) => {
    try {
      localStorage.setItem(NAV_KEY, JSON.stringify(v))
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

/** Mar's Ambient dock: no sidebar, one dock at the bottom (MarDock.vue). */
export const marDockOn = computed(
  () => can.value.design && active.value.shell === 'dock' && marNav.id === 'dock'
)

/** Mar's sidebar (MarSidebar.vue), expanded or as a rail. */
export const marSideOn = computed(
  () =>
    can.value.design &&
    active.value.shell === 'dock' &&
    (marNav.id === 'sidebar' || marNav.id === 'floating')
)
watch(
  () => [marSideOn.value, marNav.collapsed, marNav.id] as const,
  ([on, rail]) => {
    const d = document.documentElement.dataset
    if (on) {
      d.marSide = rail ? 'rail' : 'open'
      // Integrated (attached to the window) or floating (a card).
      d.marSideStyle = marNav.id === 'floating' ? 'floating' : 'integrated'
    } else {
      delete d.marSide
      delete d.marSideStyle
    }
  },
  { immediate: true }
)

watch(
  marDockOn,
  (on) => {
    if (on) document.documentElement.dataset.marDock = 'on'
    else delete document.documentElement.dataset.marDock
  },
  { immediate: true }
)

/** Mar's UI (transparencies, page photos): every milestone from the new
 *  design system on. Scopes the UI rules in marShell.css. */
watch(
  () => can.value.design,
  (on) => {
    if (on) document.documentElement.dataset.marUi = 'on'
    else delete document.documentElement.dataset.marUi
  },
  { immediate: true }
)

// Navigation: Tabs (08) and Panels each have their own frame. Panels is the
// sidebar and page framed as two cards (panelsNav.css).
watch(
  () => [can.value.design, marNav.id] as const,
  ([on, id]) => {
    if (on && (id === 'tabs' || id === 'panels')) document.documentElement.dataset.marNav = id
    else delete document.documentElement.dataset.marNav
  },
  { immediate: true }
)

/** Floating panels: the sidebar card carries the Comfy wordmark and can
 *  collapse to a rail (MarPanelsHead.vue). */
export const marPanelsOn = computed(() => can.value.design && marNav.id === 'panels')

export const marSidebarClosed = computed(() => marShellOn.value && !marShell.open)

// Floating panels, collapsed from its head (MarPanelsHead.vue): the card
// narrows to a rail of icons (`data-mar-rail`, panelsNav.css).
watch(
  () => marPanelsOn.value && marNav.collapsed,
  (rail) => {
    if (rail) document.documentElement.dataset.marRail = 'on'
    else delete document.documentElement.dataset.marRail
  },
  { immediate: true }
)

// Not every page gets a photo: tools (builds, the agent, admin) stay plain.
const HERO: Record<string, string> = {
  overview: mock('hero-overview'),
  explore: mock('hero-explore'),
  tutorials: mock('hero-tutorials'),
  workflows: mock('hero-workflows'),
  apps: mock('hero-apps'),
  environments: mock('hero-overview'),
  assets: mock('hero-assets'),
  projects: mock('hero-projects'),
  spaces: mock('hero-spaces')
}

/** The photo behind the top of the current page, if it has one. */
export const heroImage = computed<string | undefined>(() => {
  const page = proto.page
  if (page.startsWith('project:')) return HERO.projects
  if (page.startsWith('tool:')) return HERO.environments
  // A space gets its brand's colour instead of a photo (spaceCover).
  if (page.startsWith('space:')) return undefined
  return HERO[page]
})

/** One space's cover: its logo tile's colour washing down from the top,
 *  with the brand colour as a glow, so a black tile (Spotify) still reads
 *  on a dark page and a white one (Nike) on a light page. */
export const spaceCover = computed<{ bg: string; accent: string } | undefined>(() => {
  if (!proto.page.startsWith('space:')) return undefined
  const brand = spaceById(proto.page.slice(6))?.brand
  return brand && { bg: brand.logo.bg ?? brand.color, accent: brand.color }
})

/** Home's background (UI Playground › Home background): Spotlight
 *  (default), Latent bloom, the photo, or one of the quieter alternatives.
 *  Canvas, Wires and Latent grade follow DS › Brand imagery. */
export type HomeBackground =
  | 'bloom'
  | 'photo'
  | 'mesh'
  | 'spotlight'
  | 'aurora'
  | 'grain'
  | 'output'
  | 'canvas'
  | 'wires'
  | 'grade'
const BG_KEY = 'comfy.design.mar.homeBackground'
function loadBackground(): HomeBackground {
  try {
    const v = localStorage.getItem(BG_KEY) as HomeBackground | null
    // Spotlight is the default; retired picks (photo, mesh, aurora, grain)
    // fall back to it.
    return v && ['bloom', 'spotlight', 'output', 'canvas', 'wires', 'grade'].includes(v)
      ? v
      : 'spotlight'
  } catch {
    return 'spotlight'
  }
}
export const homeBackground = reactive<{ id: HomeBackground }>({ id: loadBackground() })
watch(
  () => homeBackground.id,
  (id) => {
    try {
      localStorage.setItem(BG_KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

// Home's light. Milestone 1's dashboard is its stand-in, before there is a Home.
const lit = computed(() => proto.page === 'overview' || !can.value.builds)

/** Latent bloom is on screen: Home, bloom picked. */
export const bloomOn = computed(() => lit.value && homeBackground.id === 'bloom')

/** One of the quieter Home backgrounds (CSS only, MarBackdrop.vue). */
export const altBackground = computed(() =>
  lit.value && !['bloom', 'photo'].includes(homeBackground.id) ? homeBackground.id : undefined
)
