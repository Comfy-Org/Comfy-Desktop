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
    pairs: [
      { id: 'primary', do: 'One primary per surface.', dont: 'Two primaries compete.' },
      {
        id: 'centred',
        do: 'A full-width button centres its label, the icon before it.',
        dont: 'A label starting at the left: that’s a menu row.'
      },
      { id: 'square', do: 'An icon button hovers square (radius 8).', dont: 'A round hover.' }
    ],
    when: ['An action on this surface.', 'Ghost for rows, toolbars and icon-only actions.'],
    whenNot: ['Going to another page: a nav row or a link.', 'Picking one of a few options: tabs.'],
    rules: [
      'Primary is white, never blue: one per screen. Stand out with the white primary, order and size, not colour.',
      'Labels are centred in every full-width button, an icon before the label. Only menu rows and pickers start at the left.',
      'Icon buttons hover square (radius 8), never a circle, and have a tooltip.',
      'One tool per header: + when you can add, ⋯ when there’s more; no + beside a ⋯ that has Add.',
      'Destructive only for what can’t be undone, and muted. Pressed scales to 0.98.'
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
  tables: {
    heroWidth: '100%',
    when: ['A list people compare across: builds, workflows, assets, members, usage.'],
    whenNot: [
      'A few places or builds to pick from (Row cards).',
      'Recent work on Home (Cards).',
      'Any other table style: there is only this one.'
    ],
    rules: [
      'Head: 12px medium, sentence case, lightly tracked; sticky, filled only once it sticks.',
      'One grid for head and rows (--mar-grid): a header always sits over its cells.',
      'Rows 48px, inset hairlines, no zebra; hover and selected fill the row and hide its lines.',
      'Numbers right-aligned in tabular figures; the last column ends on the right.',
      'A two-line name: other cells sit on its first line (rows with selects or switches centre). Tags share the state chip’s shape.'
    ],
    tokens: [
      { name: 'height', selector: '.mar-table-head', use: 'Head' },
      { name: 'font-size', selector: '.mar-table-head', use: 'Head' },
      { name: 'min-height', selector: '.mar-table-row', use: 'Row' },
      { name: 'padding-inline', selector: '.mar-table-row', use: 'Row' },
      { name: 'column-gap', selector: '.mar-table-row', use: 'Columns' },
      { name: 'font-size', selector: '.mar-table-cell', use: 'Cell' },
      fg('--color-subtle-foreground', 'Head, sub line, quiet cells'),
      fg('--color-muted-foreground', 'Cells')
    ],
    snippet: `<div class="mar-table" style="--mar-grid: 32px minmax(0, 1fr) 120px 88px">
  <div class="mar-table-head">
    <span style="grid-column: span 2">Build</span><span>Runs on</span><span class="is-num">Deployments</span>
  </div>
  <div class="mar-table-row" tabindex="0">
    <span class="is-center"><InstanceGlyph /></span>
    <span class="mar-table-name">
      <span class="mar-table-title">My Local 1</span><span class="mar-table-sub">On this computer</span>
    </span>
    <span class="mar-table-cell">This computer</span>
    <span class="mar-table-cell is-num">2</span>
  </div>
</div>
<!-- Library pages: <div class="mar-table is-items" style="--mar-cols: …"> + MarItem layout="list" -->`
  },
  items: {
    heroWidth: '280px',
    pairs: [{ id: 'hover', do: 'Hover lightens the surface.', dont: 'The card grows on hover.' }],
    when: ['One thing in a library page, as a card or a list row.'],
    whenNot: ['Home’s recent work (Cards).', 'A short list of places or builds (Row cards).'],
    rules: [
      'Single click opens; selection is the check on hover.',
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
    play: 'card',
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
        use: 'The foreground at 5%'
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
    pairs: [
      { id: 'one', do: 'A menu for several choices.', dont: 'A menu with one option.' },
      {
        id: 'ask',
        do: 'Ask inside the menu: it turns into the question.',
        dont: 'A box in the page to confirm.'
      },
      {
        id: 'red',
        do: 'The red line last, under a divider.',
        dont: 'A red line among the others.'
      },
      {
        id: 'pick',
        do: 'One choice fills its row.',
        dont: 'A check (and its column) for a single choice.'
      }
    ],
    when: ['A list of actions or choices that opens from a trigger.'],
    whenNot: ['One option: a button or plain text.', 'Two or three always-visible choices: tabs.'],
    rules: [
      'Smoked glass a step lighter than the page; radius 14 around 6, items at 8. It grows from its trigger in 180ms.',
      'A menu of groups is rows with values: the uppercase name, what’s picked, a chevron. One level, one submenu open at a time.',
      'One choice fills its row; a check only in a multi-select.',
      'Red lines last, under a divider. One that asks first turns the menu into the question.',
      'A summary (workspace, credits) on a raised panel at the top.'
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
    pairs: [
      { id: 'corner', do: 'Controls share one corner.', dont: 'Fully rounded controls.' },
      {
        id: 'chips',
        do: 'The Filters field and its badge say what’s on.',
        dont: 'A row of filter chips under the toolbar.'
      },
      {
        id: 'counts',
        do: 'Counts in the type tabs.',
        dont: 'A count beside the title.'
      }
    ],
    when: ['Narrowing a page: its scopes as tabs; Filters, search and Layout on the right.'],
    whenNot: ['Moving between pages: the sidebar.', 'Settings: a select or a switch.'],
    rules: [
      'Tabs left; Filters, search and Layout grouped right, Layout last. All share one corner.',
      'Tabs stay: every type shows, empty or not, so the bar never shifts. An empty one says what lands there.',
      'Counts only in Assets’ type tabs; they follow the folder, filter and search.',
      'No filter chips: the Filters menu and its badge say what’s on; Clear filters (⌘⌫) is its last line.',
      'Sort lives in the Layout menu (Size, Sort by), not a select of its own.'
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
    heroWidth: '100%',
    pairs: [
      {
        id: 'named',
        do: 'A tab named after its workflow.',
        dont: 'A tab named after its build.'
      }
    ],
    when: ['The window’s top: Home, where things run, and every open workflow and app.'],
    rules: [
      'Tabs by default: Home as an icon, the build pill, a short divider, then one tab per open workflow and app.',
      'The pill says where things run; picking a build there switches it, never opens a tab.',
      'A tab is named after its workflow; a new one is “Untitled workflow”, numbered from the second.',
      'The divider after the pill is the bar’s one line (UI-RULES › No lines).',
      'Pablo’s breadcrumb is one pick away: Prototype menu › Title bar.'
    ]
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
  toast: {
    heroWidth: '100%',
    when: ['Something changed state on the page you stay on: Restored, Stopped, a build updated.'],
    whenNot: [
      'After a redirect: the page you land on shows the change.',
      'Opening things, or a pick in a picker.',
      'Repeating what the screen already says.'
    ],
    rules: [
      'Only when you stay on the page and something changes state.',
      'Top right, under the title bar; one at a time.',
      'Undo when it can be undone.',
      'Glass in its tone, no border.'
    ]
  },
  'template-modal': {
    rules: [
      'The stage runs to the frame’s edges: zoomed in, the picture or the graph is cut by its rounded corners.',
      'Result / Graph and zoom take the menu glass, the same as the menu they open.',
      'More (⋯) sits at the top right by the name; a couple of quick actions (Favorite, Copy link) sit there as icons.',
      'Open in comes first, What it needs right under it (it changes with the build) and unfolds downward.',
      'The foot keeps only the main action.'
    ]
  },
  'asset-view': {
    rules: [
      'The picture fits the stage; zoomed, it fills it up to its rounded edges, never a box inside it.',
      'Zoom (and Compare) bottom right in the menu glass; the percentage opens the slider and its shortcuts.',
      'The details are a panel a step lighter, 14px corners, no stroke, no shadow.',
      'More (⋯) at the top right by the name; the foot keeps Download and Open workflow.',
      'Section titles are uppercase labels; field names stay sentence case.'
    ]
  },
  'media-badge': {
    heroWidth: '320px',
    pairs: [
      {
        id: 'badge',
        do: 'A badge that tells something: a video’s length.',
        dont: 'A badge on a plain image.'
      }
    ],
    when: ['A video’s length, or what a tile is, over its picture.'],
    whenNot: ['A plain image in Assets: the picture says it.', 'A run’s state: Status chips.'],
    rules: [
      'Bottom left, 8px in: the light dark glass pill (rgb(14 14 16 / 0.28), blur 14px).',
      'A video: its icon and length, counting while it plays on hover; the bar along the bottom scrubs.',
      'On hover a title can take the corner (Apps tiles fade the badge).'
    ],
    tokens: [
      { name: 'height', selector: '.mar-asset-len', use: 'Pill' },
      { name: 'padding', selector: '.mar-asset-len', use: '' },
      { name: 'border-radius', selector: '.mar-asset-len', use: '' },
      { name: 'background-color', selector: '.mar-asset-len', use: 'Glass over pictures' },
      { name: 'backdrop-filter', selector: '.mar-asset-len', use: '' }
    ]
  },
  'file-tile': {
    heroWidth: '240px',
    when: ['A file with no picture of its own: sound, 3D, text, data.'],
    whenNot: ['Anything with a picture: its picture.', 'An output still running: Status chips.'],
    rules: [
      'It draws its kind: the kind’s icon or a hint of what is inside, and the extension, on a soft tile.',
      'Hue and strength are fixed per kind and mixed into the theme, so a wall of files sits at one level.',
      'The same on Desktop and in ComfyUI.',
      'Small tiles (a list row) keep the wash and the icon.'
    ]
  },
  'select-bar': {
    heroWidth: '100%',
    when: ['What you can do to everything selected in a library page.'],
    whenNot: ['One item: its own ⋯ menu.'],
    rules: [
      'Inverted, at the foot, centred on the page’s column.',
      'The count, Select all, the common actions; Esc lets go.',
      'A submenu opens upward (Move to project, Label).',
      'Delete last, in red.'
    ]
  },
  activity: {
    heroWidth: '720px',
    when: ['What happened lately in a space or project, newest first.'],
    rules: ['Milestones on a vertical line: time · dot · who did what.']
  }
}
