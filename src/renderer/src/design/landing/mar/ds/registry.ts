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
  /** Foundations: docs under Details, and a Code tab (top level). */
  doc?: Component
  code?: Component
  /** Controls for every frame, above them (pages/MotionBar.vue). */
  bar?: Component
  /** A page drawn by itself, without theme frames (the Playground). */
  custom?: Component
}

/** Where a page sits in the nav, in this order. */
export const GROUPS = ['', 'Foundations', 'Components', 'Patterns'] as const

const lazy = (load: () => Promise<{ default: Component }>): Component => defineAsyncComponent(load)

/** A library page in its four Page states (pages/LibraryPage.vue). */
const library = (page: string): Component =>
  defineAsyncComponent(async () => {
    const { default: LibraryPage } = await import('./pages/LibraryPage.vue')
    return defineComponent(() => () => h(LibraryPage, { page }))
  })

/** Materials · Blur's docs, by tab (pages/MaterialsDoc.vue). */
const part = (which: 'details' | 'code'): Component =>
  defineAsyncComponent(async () => {
    const { default: MaterialsDoc } = await import('./pages/MaterialsDoc.vue')
    return defineComponent(() => () => h(MaterialsDoc, { part: which }))
  })

/** Colour, Type and Radius (pages/FoundationTokens.vue). */
const tokens = (kind: 'colour' | 'type' | 'radius'): Component =>
  defineAsyncComponent(async () => {
    const { default: FoundationTokens } = await import('./pages/FoundationTokens.vue')
    return defineComponent(() => () => h(FoundationTokens, { kind }))
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
  { id: 'about', label: 'About', group: '', title: 'Comfy Desktop · Design system' },
  {
    id: 'colour',
    label: 'Colour',
    group: 'Foundations',
    title: 'Colour',
    source:
      'ui/tokens.css (light: ui/looks/light.css; the New UI overrides in mar/shell/marShell.css)',
    use: 'Grey scale UI; colour only for status and progress.',
    component: tokens('colour')
  },
  {
    id: 'type',
    label: 'Type',
    group: 'Foundations',
    title: 'Type',
    source: 'ui/tokens.css',
    use: 'Four sizes: 13px for body, navigation and controls; 16, 22 and 34 above it.',
    component: tokens('type')
  },
  {
    id: 'radius',
    label: 'Radius',
    group: 'Foundations',
    title: 'Radius',
    source: 'ui/tokens.css, mar/uiTuner.ts (Corners)',
    use: 'Soft corners; inner = outer − padding.',
    component: tokens('radius')
  },
  {
    id: 'theme-playground',
    label: 'Theme playground',
    group: 'Foundations',
    title: 'Theme playground',
    source: 'ComfyUI_frontend packages/design-system/src/css/_palette.css, theme.css',
    use: 'Its own page, full screen: tokens for dark and light, edited on the real New Home and ComfyUI.',
    custom: lazy(() => import('./pages/ThemePlaygroundLink.vue'))
  },
  {
    id: 'materials-blur',
    label: 'Materials · Blur',
    group: 'Foundations',
    title: 'Materials · Blur',
    source:
      'mar/menus/layers.css, mar/shell/marShell.css, mar/search/search.css, mar/templateModal/templateModal.css, mar/pages/ (MarStatus, MarItem, MarSelectBar), ui/tokens.css',
    use: 'How blur is used, level by level, so it can be built exactly: the values, who uses them, the rules and the CSS.',
    component: lazy(() => import('./pages/MaterialsPage.vue')),
    doc: part('details'),
    code: part('code')
  },
  {
    id: 'motion',
    label: 'Motion',
    group: 'Foundations',
    title: 'Motion',
    source:
      'mar/motion/motion.css, ui/tokens.css, and each component’s own transitions (named on each)',
    use: 'Every animation in the default view: trigger, duration, easing, what moves, and what reduced motion does.',
    component: lazy(() => import('./pages/MotionPage.vue')),
    bar: lazy(() => import('./pages/MotionBar.vue'))
  },
  {
    id: 'interactions',
    label: 'Interactions',
    group: 'Foundations',
    title: 'Interactions',
    source:
      'mar/pages/library.ts, collection.ts, undo.ts, MarItem.vue, MarItemMenu.vue, MarSeg.vue; mar/search/MarSearch.vue; mar/graph/MarGraph.vue; mar/uiTuner.ts',
    use: 'Keyboard and pointer: focus, menus, tabs, selection, rename, undo, ⌘K, ⌘., the graph.',
    component: lazy(() => import('./pages/InteractionsPage.vue'))
  },
  {
    id: 'default-view',
    label: 'Home',
    group: 'Patterns',
    title: 'Default view',
    source: 'LandingPrototypes.vue',
    use: 'To check a component in place, next to everything around it.',
    component: lazy(() => import('./pages/DefaultViewPage.vue'))
  },
  {
    id: 'background',
    label: 'Home spotlight',
    group: 'Patterns',
    title: 'Home spotlight',
    source: 'mar/shell/MarBackdrop.vue, .is-spotlight in mar/shell/marShell.css',
    use: 'Behind Home only; other pages stay plain or take their page photo.',
    component: lazy(() => import('./pages/BackgroundPage.vue'))
  },
  {
    id: 'brand-imagery',
    label: 'Brand imagery',
    group: 'Foundations',
    title: 'Brand imagery',
    source:
      'mar/brand/imagery.ts, GradedImage.vue, WorkflowGradient.vue; mar/shell/MarWires.vue, homeBackgrounds.css',
    use: 'Any picture we make (tiles, covers, Home backgrounds): one grade, the link colours, one grain.',
    component: lazy(() => import('./pages/BrandImageryPage.vue'))
  },
  {
    id: 'user',
    label: 'User',
    group: 'Patterns',
    title: 'First-time and Returning',
    source: 'mar/userStates/ (userState.ts, ExampleArc.vue, MarSpacesEmpty.vue)',
    use: 'Check every page for someone who has made nothing yet.',
    component: lazy(() => import('./pages/UserPage.vue'))
  },
  {
    id: 'title-bar',
    label: 'Title bar',
    group: 'Components',
    title: 'Title bar',
    source:
      'parts/DesktopTitleBar.vue, parts/nav/TitleBarBreadcrumb.vue, parts/nav/SwitcherMenu.vue',
    use: 'The browser stand-in for the app bar; the breadcrumb is where you switch builds (not on Comfy Cloud).',
    component: lazy(() => import('./pages/TitleBarPage.vue'))
  },
  {
    id: 'sidebar',
    label: 'Sidebar',
    group: 'Components',
    title: 'Sidebar',
    source:
      'mar/modes/MarModeSwitch.vue, mar/modes/MarModeSeg.vue, parts/env/ModeNav.vue, mar/shell/MarFavoritesGroup.vue, mar/shell/MarSignIn.vue, mar/shell/MarGroupTitle.vue, parts/env/SidebarGroup.vue, parts/space/SpacesGroup.vue, parts/WorkspaceMenu.vue',
    use: 'Navigation between lenses, pages, projects and spaces; credits and the workspace at the foot.',
    component: lazy(() => import('./pages/SidebarPage.vue'))
  },
  {
    id: 'search',
    label: 'Search',
    group: 'Components',
    title: 'Global search',
    source: 'mar/search/MarSearch.vue (search.ts), parts/env/ModeNav.vue (the sidebar row)',
    use: "Find anything or run a quick action: ⌘K anywhere, or the first row of Create's sidebar.",
    component: lazy(() => import('./pages/SearchPage.vue'))
  },
  {
    id: 'tooltip',
    label: 'Tooltip',
    group: 'Components',
    title: 'Tooltip',
    source: 'ui/Tooltip.vue (.mar-tip in mar/shell/marShell.css)',
    use: 'Name an icon-only control or explain a state; never for text already on screen.',
    component: lazy(() => import('./pages/TooltipPage.vue'))
  },
  {
    id: 'toast',
    label: 'Toast',
    group: 'Components',
    title: 'Toast',
    source: 'mar/pages/MarUndoToast.vue, mar/pages/undo.ts',
    use: 'Say that something changed on the page you stay on. Never after a redirect.',
    component: lazy(() => import('./pages/ToastPage.vue'))
  },
  {
    id: 'icons',
    label: 'Icons',
    group: 'Components',
    title: 'Production icons',
    source: 'mar/icons/ (comfyIcons.ts, kindIcons.ts, agentChat.ts)',
    use: 'Where production already has the concept, use its icon; otherwise lucide.',
    component: lazy(() => import('./pages/IconsPage.vue'))
  },
  {
    id: 'prompt',
    label: 'Prompt box',
    group: 'Components',
    title: 'Prompt box',
    source: 'parts/PromptBox.vue with .mar-prompt (mar/shell/marShell.css)',
    use: "Home's one place to type: what to make, and on which build.",
    component: lazy(() => import('./pages/PromptPage.vue'))
  },
  {
    id: 'cards',
    label: 'Cards',
    group: 'Components',
    title: 'Cards',
    source:
      'ui/SectionHeader.vue, mar/WorkflowCard.vue (ui/MediaCard.vue), parts/space/SpaceCard.vue, parts/space/DeployedTo.vue',
    use: 'Recently used for workflows, Spaces for spaces; the Draft chip where a workflow is in no space.',
    component: lazy(() => import('./pages/CardsPage.vue'))
  },
  {
    id: 'row-cards',
    label: 'Row cards',
    group: 'Components',
    title: 'Row cards',
    source: 'mar/MarStartWhere.vue, mar/MarBuildsRow.vue (.mar-row-card in mar/shell/marShell.css)',
    use: 'A short list of places or builds, each with its action at the end.',
    component: lazy(() => import('./pages/RowCardsPage.vue'))
  },
  {
    id: 'banner',
    label: "What's new",
    group: 'Components',
    title: "What's new",
    source: 'mar/LaunchBanner.vue',
    use: 'One launch at a time on Home; the dots step through the others.',
    component: lazy(() => import('./pages/BannerPage.vue'))
  },
  {
    id: 'buttons',
    label: 'Buttons',
    group: 'Components',
    title: 'Buttons',
    source: 'ui/Button.vue, ui/button.variants.ts',
    use: 'Primary once per surface; ghost for rows and icons; link for section links.',
    component: lazy(() => import('./pages/ButtonsPage.vue'))
  },
  {
    id: 'menus',
    label: 'Menus',
    group: 'Components',
    title: 'Menus',
    source:
      'mar/CreateMenu.vue, mar/MarWorkspaceMenu.vue, mar/MarCreditsFlyout.vue, mar/runOn/MarRunOn.vue, parts/PromptBox.vue, parts/nav/SwitcherMenu.vue (menu family in mar/shell/marShell.css, layers in mar/menus/layers.css)',
    use: 'Any list of actions or choices that opens from a trigger.',
    component: lazy(() => import('./pages/MenusPage.vue'))
  },
  {
    id: 'tabs-filters',
    label: 'Filters bar',
    group: 'Patterns',
    title: 'Filters bar',
    source:
      'mar/pages/MarSeg.vue, ui/Select.vue, mar/pages/MarSearchField.vue, mar/pages/MarViewToggle.vue, mar/assets/AssetViewMenu.vue',
    use: 'Narrow a page: tabs for its scopes on the left; filters, sort, search and view on the right.',
    component: lazy(() => import('./pages/TabsFiltersPage.vue'))
  },
  {
    id: 'status',
    label: 'Status chips',
    group: 'Components',
    title: 'Status chips',
    source: 'mar/pages/MarStatus.vue',
    use: 'The state of a run, build or item, next to its name or on its picture.',
    component: lazy(() => import('./pages/StatusPage.vue'))
  },
  {
    id: 'items',
    label: 'Items',
    group: 'Components',
    title: 'Items',
    source: 'mar/pages/MarItem.vue (MarItemMenu.vue, MarStatus.vue, FavoriteStar.vue)',
    use: 'One thing in a library page, as a card or a list row: open, select, star, rename.',
    component: lazy(() => import('./pages/ItemsPage.vue'))
  },
  {
    id: 'tables',
    label: 'Tables',
    group: 'Components',
    title: 'Tables',
    source:
      'mar/table/table.css (mar/deploy/DeploymentsTable.vue, MarItem list rows, is-mar-* hooks in shared parts)',
    use: 'The one table: every list view (Builds, Workflows, Apps, Assets, Projects, Spaces, Space members and tools, Models, Deployments, Logs, API keys).',
    component: lazy(() => import('./pages/TablesPage.vue'))
  },
  {
    id: 'empty',
    label: 'Empty states',
    group: 'Patterns',
    title: 'Empty states',
    source: 'mar/pages/MarEmpty.vue (pictures in mar/pages/emptyArt.ts)',
    use: 'Every place with nothing in it, no results, or an error: one design everywhere.',
    component: lazy(() => import('./pages/EmptyPage.vue'))
  },
  {
    id: 'cards-grid',
    label: 'Cards grid',
    group: 'Patterns',
    title: 'Cards grid',
    source: 'mar/pages/MarItem.vue in mar/pages/MarWorkflowsPage.vue, MarAssetsPage.vue',
    use: 'A library page’s items as a grid of cards, the toolbar above.',
    component: lazy(() => import('./pages/CardsGridPage.vue'))
  },
  {
    id: 'menus-summary',
    label: 'Menus with summary',
    group: 'Patterns',
    title: 'Menus with summary',
    source: 'mar/MarWorkspaceMenu.vue, mar/MarCreditsFlyout.vue (mar/menus/layers.css)',
    use: 'A menu that first says where you are or what you have, then offers what to do.',
    component: lazy(() => import('./pages/MenusSummaryPage.vue'))
  },
  {
    id: 'activity',
    label: 'Recent activity',
    group: 'Components',
    title: 'Recent activity',
    source: 'mar/activity/MarActivityTimeline.vue',
    use: 'What happened lately in a space or project, newest first.',
    component: lazy(() => import('./pages/ActivityPage.vue'))
  },
  ...LIBRARY.map((l) => ({
    id: `lib-${l.page}`,
    label: `Library · ${l.label}`,
    group: 'Patterns',
    title: `Library · ${l.label}`,
    source: `${l.source} (shell: mar/pages/MarPage.vue, pageState.ts)`,
    use: l.use,
    component: library(l.page)
  })),
  {
    id: 'project-space',
    label: 'Page header',
    group: 'Patterns',
    title: 'Page header',
    source:
      'mar/pages/MarProjectPage.vue, mar/pages/MarSpacePage.vue, mar/pages/MarSpaceSetup.vue, mar/pages/MarEntityHeader.vue, mar/pages/MarAddress.vue, mar/pages/MarSplitButton.vue',
    use: 'One project or one space: what it holds, its latest output and activity.',
    component: lazy(() => import('./pages/ProjectSpacePage.vue'))
  },
  {
    id: 'template-modal',
    label: 'Template modal',
    group: 'Patterns',
    title: 'Template modal',
    source: 'mar/templateModal/ (MarTemplateModal.vue, TplGraph.vue, templateModal.css)',
    use: 'Opening any example or template: see what it makes, then open it where it runs.',
    component: lazy(() => import('./pages/TemplateModalPage.vue'))
  },
  {
    id: 'build',
    label: 'Build and deploy',
    group: 'Patterns',
    title: 'Build and deploy',
    source:
      'mar/build/ (MarBuildStart.vue, MarModelsPage.vue, ModelTile.vue), mar/deploy/MarDeployModal.vue',
    use: 'The Build lens: a first call, the models, and shipping a build as an API.',
    component: lazy(() => import('./pages/BuildPage.vue'))
  },
  {
    id: 'graph',
    label: 'Graph editor',
    group: 'Patterns',
    title: 'Graph editor',
    source: 'mar/graph/ (MarGraph.vue, CanvasNode.vue, canvasData.ts)',
    use: 'A build’s tab: the workflow’s graph, with the way back Home.',
    component: lazy(() => import('./pages/GraphPage.vue'))
  }
]
