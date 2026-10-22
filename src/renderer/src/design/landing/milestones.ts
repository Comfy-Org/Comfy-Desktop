import { computed, watch } from 'vue'
import { proto, type Page } from './useProto'

/**
 * The roadmap from today's Desktop to the Builder, one prototype variant per
 * milestone (the Prototype menu). Each milestone adds to the one before.
 *
 *   0  Today      - Desktop as it ships on main: its dashboard and title bar.
 *   1  Design     - the new design system; the dashboard (and what it and
 *                   its menus open) restyled, same layout. Instances still.
 *   2  Builds     - instances and builds become one concept, "Builds": a
 *                   sidebar of builds (All builds is the landing), a page per
 *                   build, the workspace switcher at the sidebar's foot.
 *   3  Breadcrumb - the title bar's new layout, a breadcrumb in every window:
 *                   Builds › build ⌄. Each build opens in its own window.
 *   4  Home       - Home leads the sidebar: first run (example workflows,
 *                   Cloud or this computer) and returning (examples, recent).
 *   5  Explore    - Explore and Learn.
 *   6  Builder    - the Build lens (deploy builds as APIs).
 *   7  One window - the long-term vision: builds open in the same window,
 *                   switched from the breadcrumb, still running.
 *   8  Projects   - future: work organised in projects, each bound to a
 *                   build; Workflows, Apps and Assets libraries.
 *   9  Spaces     - future: isolated, branded client spaces the studio
 *                   publishes apps and workflows into (admin / client view).
 */
export const MILESTONES = [
  { value: '0', label: '0 · Today (main)' },
  { value: '1', label: '1 · Design system' },
  { value: '2', label: '2 · Builds' },
  { value: '3', label: '3 · Breadcrumb' },
  { value: '4', label: '4 · Home' },
  { value: '5', label: '5 · Explore & Learn' },
  { value: '6', label: '6 · Builder' },
  { value: '7', label: '7 · One window' },
  { value: '8', label: '8 · Projects (future)' },
  { value: '9', label: '9 · Spaces (future)' }
]

/** What the current milestone has. */
export const can = computed(() => {
  const m = proto.milestone
  return {
    /** Milestone 1: the new design system (the app chrome too). */
    design: m >= 1,
    /** Milestone 2: the Builds sidebar and pages, "build" everywhere. */
    builds: m >= 2,
    breadcrumb: m >= 3,
    home: m >= 4,
    explore: m >= 5,
    builder: m >= 6,
    oneWindow: m >= 7,
    projects: m >= 8,
    spaces: m >= 9
  }
})

/** Where the launcher lands: Home once there is one, else All builds. */
export function landingPage(): Page {
  return can.value.home ? 'overview' : 'environments'
}

// Projects and Spaces follow the milestone.
watch(
  can,
  (c) => {
    proto.projects = c.projects
    proto.spaces = c.spaces
  },
  { immediate: true }
)

// Switching milestones starts fresh on its landing page, with nothing open.
watch(
  () => proto.milestone,
  () => {
    proto.tabs = []
    proto.activeTab = 'home'
    proto.mode = 'create'
    proto.page = landingPage()
    // A first-run Home only exists from Milestone 4.
    if (!can.value.home) proto.fresh = false
  }
)

// Opening on a milestone without Home lands on All builds.
if (!can.value.home && proto.page === 'overview') proto.page = 'environments'
