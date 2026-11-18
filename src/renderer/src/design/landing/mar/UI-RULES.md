# UI rules

The rules every screen of the New UI follows. Check here before building or
changing anything; add a line when a new rule is decided. Product questions
and their status live in [DECISIONS.md](DECISIONS.md); motion rules in the
DS's Motion page (`ds/motion.ts`).

## Surfaces

- **No lines.** No borders, strokes or dividers to separate things. Space
  and a fill do it. Exceptions: the title bar divider, the line above a
  modal footer, and the divider between rows of one list card.
- **Panels a step lighter.** A panel beside content (a sidebar, the asset
  view's details) is a fill a step lighter than what's behind it:
  `color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-content-background))`,
  radius 14px, no stroke, no shadow. References: `assets/AssetDetail.vue`
  `.mad-side`, the Assets tab's sidebar (`graph/MarGraph.vue` `.mg-assets-nav`).
- **Sidebars float.** Inset 8px from the edges, the full height of their
  area, never flush to the window.
- **Text blocks go in a box.** Free text (a prompt, a note) sits in a
  surface with padding and radius, never loose on a panel.
- **One card size.** A card (`rounded-[14px] bg-card`) has 18px on the
  sides, 16px top and bottom, and sits 10px from the next card, like the
  build Overview cards. Rows of the same kind (the models folders) share
  one card, split by a 1px divider inset to the card's padding; the ⋯
  glyph lands 18px from the right edge.
- **Add sits outside the cards.** An Add button for a list (Add models
  folder, Add Variable) goes below the last card, on the page, aligned
  with the cards' left edge.
- **Glass only over pictures.** Badges, chips and scrims over imagery use
  the light dark glass (`rgb(14 14 16 / 0.28)`, `blur(14px) saturate(1.5)`).

## Type

- **Section titles are uppercase labels.** Small, letter-spaced, subtle
  colour, like "ASSET DETAILS", for every section and sub-section title in
  panels, menus and details. Field names in key/value rows stay sentence
  case.
- **Dropdown titles are uppercase too.** Every group or section title inside
  a dropdown or menu uses the same uppercase label style. The locale string
  stays in sentence case; `uppercase` is applied in CSS.
- **English only** in the prototype, Figma, Linear and the repo.
- **No em dashes** in product copy.

## Buttons and actions

- **No blue in the prototype.** Run, Resume and every primary action are
  white with dark text (the toolbar Run, `--mg-run`); value fills (a
  stepper's fill) and status chips (Paused) are grey widget tokens; running
  outlines, progress bars and busy dots are the foreground white. Only data
  types keep their colour (the IMAGE wires and slots).
- **Primary is white, never blue.** One per screen. To make something
  stand out, use the white primary, order and size, not colour.
- **One tool per header.** A section header has one tool: + when you can
  add, ⋯ when there's more. If the ⋯ menu already has Add, no + beside it.
  A row's hover tools follow the same rule (a folder row: only ⋯, with New
  subfolder inside). Tags: ⋯ › New tag, Sort by.
- **Single click opens.** Cards and rows open on one click; selection is
  the check on hover.
- **More (⋯) sits at the right** of the row it belongs to (the asset view:
  beside Open workflow, under Download).
- **Modal footers: × closes, one white primary, Discard only for edits.**
  The round × closes the topmost window, with no Cancel or Back that does
  the same. The footer has one white primary on the right (Install, Add
  build, Create build, Save changes). A grey Discard sits beside it only
  where you edit something that is saved on another screen (Change setup
  over the New Build summary); there the × hides, so Discard or Save changes
  are the only ways back. Never two buttons with the same effect.
- **The × sits outside the modal.** The round × is at the card's top
  right, outside it, like New Build. Never inside the card, also when the
  modal is its own window (Desktop Settings widens the window instead).
- **Modal footers keep their line.** The thin line above a modal's footer
  stays: it is one of the lines allowed by No lines. Never remove it in an
  audit or a polish pass.

## Menus

- **⋯ and right-click open the same menu.** A build's ⋯ (on hover, at the
  right of its tile) and a right-click on the tile, its Builds row or its
  sidebar row show one shared menu. A page in the sidebar (Home, Apps,
  Assets, the Builds title) right-clicks to Open in new window only; Open
  in new tab joins it once builds share one window.
- **Build menu order:** what you can do now first (Ready: Start; Starting:
  View logs, Cancel; Running: View logs, Restart, Stop), then
  Auto start, then the rest (Manage, Update, Duplicate, Show in Finder,
  Export snapshot, Restore snapshot, Upload build), Uninstall last. No Open
  in new window: every build opens in its own window.
- **Unavailable rows stay, greyed.** A menu row that can't run in this state
  (Update while running) shows disabled, never hidden, so the menu keeps one
  shape in every state.
- **Confirm inside the menu.** A destructive line that asks first turns the
  same menu into the question (`confirm` on a `MenuLine`, see
  `pages/MarItemMenu.vue`); never a box in the page. Nothing to lose
  (a tag on 0 files), no question.
- **One choice marks its row.** A single-choice dropdown fills the picked
  row and puts a check at its end (`BaseMenuRadioItem`, `BaseSelect`), so
  the saved choice reads apart from the keyboard highlight. The highlight
  wins over the picked fill.
- **Every menu is the DS `Menu`.** Pickers, ⋯ menus and the ☰ popup use
  `@comfyorg/design-system/menu/Menu` with `MenuItem` / `MenuRadioItem`,
  like the filter menus. Never the `Select` listbox for a menu: its
  spacing drifts from the filters. A single choice fills the picked row
  with the DS selected color (`bg-muted`, `selectedMenuButtonClass`) and a check.
  Rows sit 2px apart (`gap-0.5`) so two highlighted rows never touch.
- **Every dropdown looks the same in Desktop.** Menus and select lists
  (`BaseSelect`) share one look: the popover background (a step lighter
  than the page), 4px padding, 28px rows with 12px text, the picked row
  filled with a check. For launch that is this solid look everywhere; the
  proto's smoked glass comes later, to all menus at once, never to one
  menu alone.
- **Menu dividers run edge to edge.** A divider inside a menu cancels the
  menu's padding (negative margin equal to it, like
  `ui/DropdownMenuSeparator.vue`), so it touches both sides; 1px, the
  border colour.

## Split button

- **One convention** (`pages/MarSplitButton.vue`; Desktop:
  `components/ui/SplitButton.vue` on the DS `ButtonGroup`): main half
  `px-3`, label with no trailing arrow; chevron half 30px wide, 14px
  chevron that does not rotate, full-height 1px divider; each half hovers
  on its own and an open menu keeps the chevron half in hover. Its menu
  opens 6px below, like the filter menus. With nothing to pick it is a
  plain button. Never hand-build one.
- **A split button menu hugs its rows:** never narrower than the
  button, at most 320px (long names truncate, full name on hover), rows
  keep 20px on the right.
- **Status in a build menu row is a dot on the icon**, like the sidebar
  glyph: green for live (Running, Always on), red for broken or didn't
  start, nothing for Ready. No status text. A broken build is disabled
  and gives its reason on hover.
- **One submenu open at a time** (controlled `DropdownMenuSub`, see
  `graph/AssetFilterMenu.vue`).
- **A filter shows as a chip** under the toolbar, removable, with Clear
  filters (⌘⌫).
- **Tabs stay.** Type tabs (All, Images, Videos, 3D, Audio) always show,
  empty or not, so the bar never shifts. An empty one says what lands there
  ("No 3D files yet"), never "Nothing matches", which is only for a search
  or a filter.
- **Tools come with content.** Search, sort, filters, view tabs and actions
  that need content (Export All) show as soon as the page has one item
  anywhere, in any tab, and stay while it does:
  - Nothing at all on the page: hide them; keep only what creates content
    (New build, Import, Create) next to the empty state.
  - Content exists but this tab or filter is empty: keep every tool and
    tab; the empty state names the tab ("No cloud builds").
  - A search or filter with no results: keep every tool; "Nothing matches"
    with Clear filters.
- **No counts on tabs.** No tab row shows a number ("Images", not
  "Images 4"), Assets included, and no count beside the title either.

## Tiles

- **The whole tile is the action.** A build tile or row on Home and Builds
  has no Start or Update button: a click starts it, opens it when it runs,
  shows its logs while starting and opens its page when broken; the hover hint
  says which (Click to start / open / view logs). An update waiting is a
  grey "Update" note after the version; Update is in ⋯.
- **Tiles stack when they don't fit.** Below the width where a tile can't
  hold its name and status, Home's build tiles go one per row; never
  squeeze two side by side. A tile in progress looks like every other
  tile: no buttons inside, status line plus the bar along the bottom, a
  click opens its logs, actions live in ⋯.
- **Build cards have no buttons or links, only ⋯.** The whole card is the
  action: ready starts, starting or installing opens logs, running opens.
  Status on top; the version and a grey "Update" note on the
  bottom line, plain text. Update, and everything else, lives in ⋯.

## Feedback

- **Premium is a gold crown.** An app or template that costs credits gets
  ComfyUI's crown, icon only, in a 28px glass square at the top left of its
  picture (a corner no other control uses), in the credits gold
  (`--upgrade`, #e9c422). Hover is the usual one-line tooltip, "Premium app, runs with credits".
  Free ones get nothing.
- **Badges explain on hover, no ? inside.** A badge (Downloads, Shared,
  Build) is the tooltip trigger itself, on hover and keyboard focus. The ?
  icon is only for section titles and field labels.
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
