/**
 * What each page says around its live examples (DsApp.vue's template):
 * when to use it, the rules that matter, its tokens (read live in the
 * frame, kit/SpecsTable.vue) and a minimal snippet. Decisions only.
 */
export interface Token {
  /** A CSS variable (`--x`) or a CSS property of `selector`. */
  name: string
  use: string
  selector?: string
}

export interface Prop {
  name: string
  type: string
  default?: string
  use: string
}

export interface Content {
  /** Which section and cell make the large example (default: the first). */
  hero?: [number, number]
  /** The example's width when it isn't its own (rows, bars: the column). */
  heroWidth?: string
  when?: string[]
  whenNot?: string[]
  /** At most five. */
  rules?: string[]
  tokens?: Token[]
  /** HTML measured for tokens when the hero doesn't hold the element. */
  probe?: string
  snippet?: string
  props?: Prop[]
  /** Its Playground spec (mar/ds/play.ts), for props and usage. */
  play?: string
  /** Do / Don't pairs, drawn live in pages/DoDont.vue by `id`. */
  pairs?: { id: string; do: string; dont: string }[]
}

const fg = (n: string, use: string): Token => ({ name: n, use })

export const CONTENT: Record<string, Content> = {
  buttons: {
    pairs: [{ id: 'primary', do: 'One primary per surface.', dont: 'Two primaries compete.' }],
    when: ['An action on this surface.', 'Ghost for rows, toolbars and icon-only actions.'],
    whenNot: ['Going to another page: a nav row or a link.', 'Picking one of a few options: tabs.'],
    rules: [
      'One primary (inverted: white in dark, near-black in light) per surface.',
      'Destructive only for what can’t be undone, and muted.',
      'Icon-only buttons have a tooltip.',
      'Pressed scales to 0.98; nothing else moves.'
    ],
    tokens: [
      { name: 'height', selector: 'button', use: 'md; sm 28, lg 36' },
      { name: 'border-radius', selector: 'button', use: '--radius-control' },
      { name: 'padding-inline', selector: 'button', use: 'md' },
      { name: 'font-size', selector: 'button', use: '--text-ui' },
      fg('--color-inverted-background', 'Primary fill'),
      fg('--color-border-focus', 'Focus ring, 2px')
    ],
    play: 'button'
  },
  tooltip: {
    pairs: [
      { id: 'tip', do: 'Name an icon-only button.', dont: 'Repeat a label already on screen.' }
    ],
    when: ['Naming an icon-only control.', 'Saying why something is disabled.'],
    whenNot: ['Text already on screen.', 'Help longer than a line or two: a popover.'],
    rules: [
      'A small glass label, 8px corners (dark in dark mode, light in light).',
      'Wraps at 256px.',
      'Fades in over 160ms; never moves.'
    ],
    probe: '<div class="mar-tip">Open in Cloud</div>',
    tokens: [
      { name: 'padding', selector: '.mar-tip', use: '' },
      { name: 'border-radius', selector: '.mar-tip', use: '' },
      { name: 'font-size', selector: '.mar-tip', use: '' },
      { name: 'backdrop-filter', selector: '.mar-tip', use: 'Glass · tooltip' },
      { name: 'background-color', selector: '.mar-tip', use: '' }
    ],
    play: 'tooltip'
  },
  status: {
    pairs: [{ id: 'run', do: 'Production’s run states.', dont: 'Percentages on items.' }],
    when: ['The state of a run, build or item, next to its name or on its picture.'],
    whenNot: ['Progress percentages: they live in the queue.', 'Decoration or categories.'],
    rules: [
      'Running spins, Completed is a check, Failed an octagon, Draft a hollow dot.',
      'Colour means status; nothing else is coloured.',
      'On a picture: dark glass in both themes, light words, the colour in the icon.',
      'On cards: top-left, moving right for the select check.'
    ],
    tokens: [
      { name: 'height', selector: '.mar-status', use: '' },
      { name: 'padding', selector: '.mar-status', use: '' },
      { name: 'border-radius', selector: '.mar-status', use: '' },
      { name: 'font-size', selector: '.mar-status', use: '' },
      fg('--color-status-running', 'Running, live'),
      fg('--color-status-danger', 'Failed, over a limit'),
      fg('--color-media-overlay', 'Chip on a picture')
    ],
    play: 'status'
  },
  items: {
    heroWidth: '280px',
    pairs: [{ id: 'hover', do: 'Hover lightens the surface.', dont: 'The card grows on hover.' }],
    when: ['One thing in a library page, as a card or a list row.'],
    whenNot: ['Home’s recent work (Cards).', 'A short list of places or builds (Row cards).'],
    rules: [
      'Hover lightens the surface; the card never grows.',
      'The star and ⋯ show on hover.',
      'No picture yet: the canvas’s dot grid and the kind’s icon.',
      'Double-click the name to rename it in place.'
    ],
    tokens: [
      { name: 'border-radius', selector: '.mar-item', use: '--radius-card' },
      { name: 'padding', selector: '.mar-item', use: 'Grid' },
      { name: 'background-color', selector: '.mar-item', use: 'Solid surface' },
      { name: 'transition', selector: '.mar-item', use: 'Hover' }
    ],
    play: 'item'
  },
  cards: {
    heroWidth: '320px',
    hero: [1, 0],
    when: ['Home’s recent work and spaces, picture first.'],
    whenNot: ['A library page: Items.', 'Places or builds to pick from: Row cards.'],
    rules: [
      'No borders, no lit top edge.',
      'Hover lightens the surface; nothing grows.',
      'The Draft chip only where a workflow is in no space.'
    ],
    tokens: [
      { name: 'border-radius', selector: "[role='button']", use: '--radius-card' },
      {
        name: 'background-color',
        selector: "[role='button']",
        use: 'The foreground at 5% (solid card colour with Crit feedback On)'
      }
    ]
  },
  'row-cards': {
    heroWidth: '100%',
    when: ['A short list of places or builds, each with its action at the end.'],
    whenNot: ['More than a handful of items: a library page.'],
    rules: [
      'One card, 72 tall, 16px corners.',
      'A 40px icon tile at 10px.',
      'The action sits at the end.'
    ],
    tokens: [
      { name: 'height', selector: '.mar-row-card', use: '' },
      { name: 'border-radius', selector: '.mar-row-card', use: '' },
      { name: 'padding', selector: '.mar-row-card', use: '' }
    ]
  },
  menus: {
    pairs: [{ id: 'one', do: 'A menu for several choices.', dont: 'A menu with one option.' }],
    when: ['A list of actions or choices that opens from a trigger.'],
    whenNot: ['One option: a button or plain text.', 'Two or three always-visible choices: tabs.'],
    rules: [
      'Smoked glass a step lighter than the page; radius 14 around 6, items at 8.',
      'A summary (workspace, credits) on a raised panel at the top.',
      'The current pick is raised.',
      'It grows from its trigger in 180ms.',
      'Destructive last, in red.'
    ],
    probe:
      '<div role="menu" data-state="open"><div role="menuitem">Open in Cloud</div><div role="menuitem">Duplicate</div></div>',
    tokens: [
      { name: 'border-radius', selector: "[role='menu']", use: '--mar-menu-radius' },
      { name: 'padding', selector: "[role='menu']", use: '--mar-menu-pad' },
      { name: 'backdrop-filter', selector: "[role='menu']", use: 'Glass · menu' },
      { name: 'background-color', selector: "[role='menu']", use: '' },
      { name: 'box-shadow', selector: "[role='menu']", use: 'Ring and drop' }
    ]
  },
  'tabs-filters': {
    heroWidth: '100%',
    pairs: [{ id: 'corner', do: 'Controls share one corner.', dont: 'Fully rounded controls.' }],
    when: ['Narrowing a page: its scopes as tabs; filters, Sort, search and view on the right.'],
    whenNot: ['Moving between pages: the sidebar.', 'Settings: a select or a switch.'],
    rules: [
      'Tabs left, the rest grouped right.',
      'An indicator slides to the picked tab; counts hidden.',
      'Tabs, filters, sort, search and view share one corner (Corners: Soft 10/7, Default 6/3); buttons keep --radius-control.',
      'No fully rounded controls; Sort is an icon.'
    ],
    tokens: [
      fg('--mar-tab-radius', 'Track and controls'),
      fg('--mar-tab-item-radius', 'What sits in a track'),
      { name: 'height', selector: '.mar-pseg-btn', use: 'Tab' },
      { name: 'padding', selector: '.mar-pseg', use: 'Track' }
    ],
    play: 'tabs'
  },
  empty: {
    heroWidth: '100%',
    pairs: [{ id: 'one', do: 'One action fills it.', dont: 'A row of competing actions.' }],
    when: ['A place with nothing in it yet, no results, or an error.'],
    whenNot: ['A loading state: skeletons in the content’s shape.'],
    rules: [
      'Three pictures of what will live here, the place’s icon, one line.',
      'The one action that fills it; a second only if quieter.',
      'Errors use the same design, with Try again.'
    ],
    play: 'empty'
  },
  prompt: {
    heroWidth: '720px',
    when: ['Home’s one place to type: what to make, and on which build.'],
    whenNot: ['Searching: ⌘K.'],
    rules: [
      'One line; three while typing, over the content.',
      'A very faint edge: a 9% outline, 14% while typing.',
      'The build picker shows the build itself.'
    ],
    tokens: [
      { name: 'border-radius', selector: '.mar-prompt', use: '' },
      { name: 'backdrop-filter', selector: '.mar-prompt', use: 'Surface · prompt' }
    ]
  },
  'title-bar': {
    when: ['The window’s top: where you are, and switching builds.'],
    rules: ['Solid in the app; the breadcrumb switches builds.']
  },
  sidebar: {
    when: ['Moving between lenses, pages, projects and spaces.'],
    rules: [
      'Rows of 32, 13px, 15px icons.',
      'Empty groups don’t show; Favorites once something is starred (up to four).',
      'One way to add per group, on its title.',
      'Credits and the workspace at the foot.'
    ]
  },
  search: {
    hero: [1, 0],
    heroWidth: '100%',
    when: ['Finding anything or running a quick action: ⌘K, or the sidebar’s first row.'],
    whenNot: ['Narrowing one page: its own search field.'],
    rules: ['Opens from ⌘K anywhere, or the sidebar’s first row.', 'Pictures first, little text.']
  },
  icons: {
    pairs: [
      { id: 'workflow', do: 'Production’s workflow icon.', dont: 'A look-alike from Lucide.' }
    ],
    when: ['Where production has the concept, its icon.'],
    whenNot: ['Inventing a new glyph for a known concept.'],
    rules: [
      'Workflow: the Comfy graph icon. App: panels-top-left.',
      'Agent: a chat with a corner sparkle. Credits: coins in gold.',
      'Lucide for the rest.'
    ]
  },
  banner: {
    play: 'banner',
    heroWidth: '100%',
    when: ['One launch at a time on Home.'],
    rules: ['A wide banner, no section title.', 'Dots step through; the active one fills over 7s.']
  },
  activity: {
    heroWidth: '720px',
    when: ['What happened lately in a space or project, newest first.'],
    rules: ['Milestones on a vertical line: time · dot · who did what.']
  }
}
