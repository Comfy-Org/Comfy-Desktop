# UI rules

The rules every screen of the New UI follows. Check here before building or
changing anything; add a line when a new rule is decided. Product questions
and their status live in [DECISIONS.md](DECISIONS.md); motion rules in the
DS's Motion page (`ds/motion.ts`).

## Surfaces

- **No lines.** No borders, strokes or dividers to separate things. Space
  and a fill do it.
- **Panels a step lighter.** A panel beside content (a sidebar, the asset
  view's details) is a fill a step lighter than what's behind it:
  `color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-content-background))`,
  radius 14px, no stroke, no shadow. References: `assets/AssetDetail.vue`
  `.mad-side`, the Assets tab's sidebar (`graph/MarGraph.vue` `.mg-assets-nav`).
- **Sidebars float.** Inset 8px from the edges, the full height of their
  area, never flush to the window.
- **Text blocks go in a box.** Free text (a prompt, a note) sits in a
  surface with padding and radius, never loose on a panel.
- **Glass only over pictures.** Badges, chips and scrims over imagery use
  the light dark glass (`rgb(14 14 16 / 0.28)`, `blur(14px) saturate(1.5)`).
- **Zoom runs to the edges.** A zoomed picture fills the whole stage up to
  its rounded edges, never a box inside it. Controls on the stage (Result/
  Graph, zoom) take the menu glass (`menus/layers.css`), the same as the
  menu they open, and blur what passes under them.

## Type

- **Section titles are uppercase labels.** Small, letter-spaced, subtle
  colour, like "ASSET DETAILS", for every section and sub-section title in
  panels, menus and details. Field names in key/value rows stay sentence
  case.
- **English only** in the prototype, Figma, Linear and the repo.
- **No em dashes** in product copy.

## Buttons and actions

- **Primary is white, never blue.** One per screen. To make something
  stand out, use the white primary, order and size, not colour.
- **Labels are centred** in every full-width button, primary or not
  (an icon goes before the label, centred with it). Only menu rows and
  pickers start at the left.
- **One tool per header.** A section header has one tool: + when you can
  add, ⋯ when there's more. If the ⋯ menu already has Add, no + beside it.
  A row's hover tools follow the same rule (a folder row: only ⋯, with New
  subfolder inside). Tags: ⋯ › New tag, Sort by.
- **Single click opens.** Cards and rows open on one click; selection is
  the check on hover.
- **More (⋯) sits at the top right** of a modal's panel, by the name
  (the asset view, the workflow view). A menu with only a couple of quick
  actions isn't a menu: they go there as icons (a workflow's Favorite and
  Copy link). The foot keeps only the main action.
- **What a pick changes sits right under it.** Open in comes first, What
  it needs straight under it (it changes with the build) and unfolds
  downward; the foot keeps only the main action.
- **Confirm inside the menu.** A destructive line that asks first turns the
  same menu into the question (`confirm` on a `MenuLine`, see
  `pages/MarItemMenu.vue`); never a box in the page. Nothing to lose
  (a tag on 0 files), no question.
- **A red line has a divider over it.** Delete, Remove, Stop or anything
  red in a menu always sits under a hairline divider, the one other line
  No lines allows. `MarItemMenu` adds it on its own for a `danger` line.
- **Icon buttons hover square** (radius 8), never a circle, in panels and
  headers.
- **One choice marks its row.** A single-choice dropdown fills the picked
  row; no check and no column kept for one. A check is only for a
  multi-select (`ui/Select.vue`).
- **One submenu open at a time** (controlled `DropdownMenuSub`, see
  `graph/AssetFilterMenu.vue`).
- **A filter shows as a chip** under the toolbar, removable, with Clear
  filters (⌘⌫).
- **A Filter menu leads with its main group open** (use case on Explore's
  Apps and Workflows); the other groups nest one level, one open at a
  time. Each choice shows how many it would leave; in the open group a
  choice that leaves none is dimmed, in a nested list it is left out.
  Groups sit apart by space, not a separator line.
- **A chip reads on its own:** when a choice only makes sense under its
  group, the chip says both ("Runs on this computer", not "This computer").
- **Tabs stay.** Type tabs (All, Images, Videos, 3D, Audio) always show,
  empty or not, so the bar never shifts. An empty one says what lands there
  ("No 3D files yet"), never "Nothing matches", which is only for a search
  or a filter.
- **Counts go in the tabs**, not beside the title ("Images 4", not "17
  assets" after the heading). They follow the open folder, filter and
  search (the type aside). Assets' type tabs only; other tab rows keep counts off.

## Feedback

- **Say only what the screen doesn't.** A note under a choice or over a
  button appears only when something non-obvious happens (a download, a
  wait, a risk); never to repeat a price, a state or the button's label.
- **Toasts only when you stay** on the page and something changes state.
  No toast after a redirect, on opening things, or for pickers.
- **Media badges bottom left**, the glass pill, 8px in: a video's icon and
  length, counting while it plays. Only where they tell something (no
  badge on a plain image in Assets). On hover a title can take the corner
  (Apps tiles fade the badge).
- **Files without a picture** (sound, 3D, text) draw their kind: the icon and
  extension on a soft tile, the same on Desktop and in ComfyUI.

## Libraries (Assets, Apps)

- **Default view: masonry, 5 columns, ungrouped.** Apps and Assets have the
  same column count unless the person changes size.
- **Video plays on hover**, muted; the bar along the bottom scrubs.
- **Upload is always on** once a build is picked, running or not (a local
  build's inputs are a folder on disk). Off only with no build picked.
- **One build at a time** in Desktop's Assets, the last used running one
  (else the local one); Everywhere is only a Playground tweak.
- **Folders nest** with a chevron, folded by default, the way to the open
  folder kept open; indent stops at the fourth level; a nested folder's
  title is a breadcrumb (top › … › parent). Desktop reaches folders from
  Filters › Folder.
- **One Assets.** ComfyUI's panel expand opens Desktop's Assets on that
  build (default); the tab is kept as Playground › Full Assets › Tab.
  The expand button reads "Open Assets page". Open workflow shows the
  asset on the canvas, on the workflow's output node (selected), the panel
  open beside it with nothing picked; never the full Assets tab.
  Double-click on an asset, in the panel or on the canvas, opens the asset
  view.

## Motion

- **Icon tabs grow:** only the picked tab shows its name, with the sliding
  pill (`.mar-tab-grow`).
- **Tools that depend on a tab** slide (the ones that stay) and fade (the
  ones that change).
- Respect `prefers-reduced-motion` on every transition.

- **Title bar is tabs** (default): Home as an icon, then the build it
  runs on (a filled pill; picking a build there switches it, never opens
  a tab), a short divider, then one tab per open
  workflow and app, so an open workflow stays in view on Home. The one
  divider allowed by No lines. Pablo's
  breadcrumb is one pick away (Prototype menu › Title bar).
- **A tab is named after its workflow**, never its build (the pill says
  where it runs). A new one is "Untitled workflow", numbered from the
  second ("Untitled workflow 2").

## Links

- **Every screen has a view code** in the address bar (`?view=…`, see
  `shareLink.ts`). The address opens the screen; Copy link adds the tweaks.
- **A new tweak** lives in its own store, `tunerContext.ts` (where it shows),
  `UiTuner.vue` (its row) and `shareLink.ts` (its parameter).

## Working on it

- **Don't re-add what was redesigned.** Check `git log -p` before porting
  from a reference; never bring back a removed control or duplicate one.
- **Pablo's files** (outside `mar/`) get only minimal hooks; his Figma
  frames are never touched.
- **Figma is editable layers**, faithful to the prototype; never
  screenshots.
