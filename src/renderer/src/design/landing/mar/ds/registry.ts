import { defineAsyncComponent, defineComponent, h, type Component } from 'vue'

/**
 * The pages, in nav order. `source` is where the component lives (paths
 * from `src/renderer/src/design/landing/`); `use` is when to reach for it.
 * A page without a component is drawn by the app itself (About).
 */
export interface DsPage {
  id: string
  label: string
  group: string
  title: string
  source?: string
  use?: string
  component?: Component
}

const lazy = (load: () => Promise<{ default: Component }>): Component => defineAsyncComponent(load)

/** A library page in its four Page states (pages/LibraryPage.vue). */
const library = (page: string): Component =>
  defineAsyncComponent(async () => {
    const { default: LibraryPage } = await import('./pages/LibraryPage.vue')
    return defineComponent(() => () => h(LibraryPage, { page }))
  })

const LIBRARY: { page: string; label: string; source: string; use: string }[] = [
  {
    page: 'workflows',
    label: 'Workflows',
    source: 'mar/pages/MarWorkflowsPage.vue',
    use: 'Every saved workflow: where it runs, its last run.'
  },
  {
    page: 'apps',
    label: 'Apps',
    source: 'mar/pages/MarAppsPage.vue',
    use: 'Apps made from workflows, to run without the graph.'
  },
  {
    page: 'assets',
    label: 'Assets',
    source: 'mar/pages/MarAssetsPage.vue',
    use: 'Every output and upload, runs in flight first.'
  },
  {
    page: 'environments',
    label: 'Builds',
    source: 'mar/pages/MarBuildsPage.vue',
    use: 'The ComfyUI builds, local and cloud: their state and actions.'
  },
  {
    page: 'projects',
    label: 'Projects',
    source: 'mar/pages/MarProjectsPage.vue',
    use: 'Work grouped by project.'
  },
  {
    page: 'spaces',
    label: 'Spaces',
    source: 'mar/pages/MarSpacesPage.vue',
    use: "Client spaces: who's in, how busy, the budget."
  },
  {
    page: 'favorites',
    label: 'Favorites',
    source: 'mar/MarFavoritesPage.vue',
    use: 'Everything starred, in one place.'
  },
  {
    page: 'settings',
    label: 'Settings',
    source: 'mar/pages/MarSettingsPage.vue',
    use: 'Opened from the workspace menu.'
  }
]

export const PAGES: DsPage[] = [
  { id: 'about', label: 'About', group: 'Docs', title: "Mar's design system" },
  {
    id: 'default-view',
    label: 'Default view',
    group: 'Put together',
    title: 'Default view',
    source: 'LandingPrototypes.vue with Proposal: Mar',
    use: 'To check a component in place, next to everything around it.',
    component: lazy(() => import('./pages/DefaultViewPage.vue'))
  },
  {
    id: 'background',
    label: 'Home spotlight',
    group: 'Put together',
    title: 'Home spotlight',
    source: 'mar/shell/MarBackdrop.vue, .is-spotlight in mar/shell/marShell.css',
    use: 'Behind Home only; other pages stay plain or take their page photo.',
    component: lazy(() => import('./pages/BackgroundPage.vue'))
  },
  {
    id: 'looks',
    label: 'Looks',
    group: 'Put together',
    title: 'Looks',
    source: 'mar/looks/ (looks.ts, grain.css)',
    use: 'To compare a whole visual language; Current is the default.',
    component: lazy(() => import('./pages/LooksPage.vue'))
  },
  {
    id: 'user',
    label: 'User',
    group: 'Put together',
    title: 'First-time and Returning',
    source: 'mar/userStates/ (userState.ts, ExampleFan.vue, MarSpacesEmpty.vue)',
    use: 'Check every page for someone who has made nothing yet.',
    component: lazy(() => import('./pages/UserPage.vue'))
  },
  {
    id: 'title-bar',
    label: 'Title bar',
    group: 'Shell',
    title: 'Title bar',
    source:
      'parts/DesktopTitleBar.vue, parts/nav/TitleBarBreadcrumb.vue, parts/nav/SwitcherMenu.vue',
    use: 'The browser stand-in for the app bar; the breadcrumb is where you switch builds.',
    component: lazy(() => import('./pages/TitleBarPage.vue'))
  },
  {
    id: 'sidebar',
    label: 'Sidebar',
    group: 'Shell',
    title: 'Sidebar',
    source:
      'mar/modes/MarModeSwitch.vue, parts/env/ModeNav.vue, mar/shell/MarGroupTitle.vue, parts/env/SidebarGroup.vue, parts/space/SpacesGroup.vue, parts/WorkspaceMenu.vue',
    use: 'Navigation between lenses, pages, projects and spaces; credits and the workspace at the foot.',
    component: lazy(() => import('./pages/SidebarPage.vue'))
  },
  {
    id: 'search',
    label: 'Search',
    group: 'Shell',
    title: 'Global search',
    source: 'mar/search/MarSearch.vue (search.ts), parts/env/ModeNav.vue (the sidebar row)',
    use: "Find anything or run a quick action: ⌘K anywhere, or the sidebar's first row.",
    component: lazy(() => import('./pages/SearchPage.vue'))
  },
  {
    id: 'tooltip',
    label: 'Tooltip',
    group: 'Shell',
    title: 'Tooltip',
    source: 'ui/Tooltip.vue (.mar-tip in mar/shell/marShell.css)',
    use: 'Name an icon-only control or explain a state; never for text already on screen.',
    component: lazy(() => import('./pages/TooltipPage.vue'))
  },
  {
    id: 'icons',
    label: 'Icons',
    group: 'Shell',
    title: 'Production icons',
    source: 'mar/icons/ (comfyIcons.ts, kindIcons.ts, agentChat.ts)',
    use: 'Where production already has the concept, use its icon; otherwise lucide.',
    component: lazy(() => import('./pages/IconsPage.vue'))
  },
  {
    id: 'prompt',
    label: 'Prompt box',
    group: 'Home',
    title: 'Prompt box',
    source: 'parts/PromptBox.vue with .mar-prompt (mar/shell/marShell.css)',
    use: "Home's one place to type: what to make, and on which build.",
    component: lazy(() => import('./pages/PromptPage.vue'))
  },
  {
    id: 'cards',
    label: 'Cards',
    group: 'Home',
    title: 'Cards',
    source:
      'ui/SectionHeader.vue, mar/WorkflowCard.vue (ui/MediaCard.vue), parts/space/SpaceCard.vue, parts/space/DeployedTo.vue',
    use: 'Recently used for workflows, Spaces for spaces; the Draft chip where a workflow is in no space.',
    component: lazy(() => import('./pages/CardsPage.vue'))
  },
  {
    id: 'row-cards',
    label: 'Row cards',
    group: 'Home',
    title: 'Row cards',
    source: 'mar/MarStartWhere.vue, mar/MarBuildsRow.vue (.mar-row-card in mar/shell/marShell.css)',
    use: 'A short list of places or builds, each with its action at the end.',
    component: lazy(() => import('./pages/RowCardsPage.vue'))
  },
  {
    id: 'banner',
    label: "What's new",
    group: 'Home',
    title: "What's new",
    source: 'mar/LaunchBanner.vue',
    use: 'One launch at a time on Home; the dots step through the others.',
    component: lazy(() => import('./pages/BannerPage.vue'))
  },
  {
    id: 'buttons',
    label: 'Buttons',
    group: 'Controls',
    title: 'Buttons',
    source: 'ui/Button.vue, ui/button.variants.ts',
    use: 'Primary once per surface; ghost for rows and icons; link for section links.',
    component: lazy(() => import('./pages/ButtonsPage.vue'))
  },
  {
    id: 'menus',
    label: 'Menus',
    group: 'Controls',
    title: 'Menus',
    source:
      'mar/CreateMenu.vue, mar/MarWorkspaceMenu.vue, mar/MarCreditsFlyout.vue, parts/PromptBox.vue, parts/nav/SwitcherMenu.vue (menu family in mar/shell/marShell.css, layers in mar/menus/layers.css)',
    use: 'Any list of actions or choices that opens from a trigger.',
    component: lazy(() => import('./pages/MenusPage.vue'))
  },
  {
    id: 'tabs-filters',
    label: 'Tabs and filters',
    group: 'Controls',
    title: 'Tabs and filters',
    source:
      'mar/pages/MarSeg.vue, ui/Select.vue, mar/pages/MarSearchField.vue, mar/pages/MarViewToggle.vue, mar/assets/AssetViewMenu.vue',
    use: 'Narrow a page: tabs for its scopes on the left; filters, sort, search and view on the right.',
    component: lazy(() => import('./pages/TabsFiltersPage.vue'))
  },
  {
    id: 'status',
    label: 'Status chips',
    group: 'Controls',
    title: 'Status chips',
    source: 'mar/pages/MarStatus.vue',
    use: 'The state of a run, build or item, next to its name or on its picture.',
    component: lazy(() => import('./pages/StatusPage.vue'))
  },
  {
    id: 'activity',
    label: 'Recent activity',
    group: 'Controls',
    title: 'Recent activity',
    source: 'mar/activity/MarActivityTimeline.vue',
    use: 'What happened lately in a space or project, newest first.',
    component: lazy(() => import('./pages/ActivityPage.vue'))
  },
  ...LIBRARY.map((l) => ({
    id: `lib-${l.page}`,
    label: l.label,
    group: 'Library pages',
    title: l.label,
    source: `${l.source} (shell: mar/pages/MarPage.vue, MarStateGate.vue, pageState.ts)`,
    use: l.use,
    component: library(l.page)
  })),
  {
    id: 'template-modal',
    label: 'Template modal',
    group: 'Flows',
    title: 'Template modal',
    source: 'mar/templateModal/ (MarTemplateModal.vue, TplGraph.vue, templateModal.css)',
    use: 'Opening any example or template: see what it makes, then open it where it runs.',
    component: lazy(() => import('./pages/TemplateModalPage.vue'))
  },
  {
    id: 'build',
    label: 'Build and deploy',
    group: 'Flows',
    title: 'Build and deploy',
    source: 'mar/build/ (MarBuildStart.vue, MarModelsPage.vue), mar/deploy/MarDeployModal.vue',
    use: 'The Build lens: a first call, the models, and shipping a build as an API.',
    component: lazy(() => import('./pages/BuildPage.vue'))
  }
]
