# Decisions

Open questions from the design-system kickoff with Pablo (2026-10-26) and
where each one stands. "In Mar" says whether it is already in the prototype
("Tweak": in the Prototype menu, to compare).

| #   | Question                                                        | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Status   | In Mar                              |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------- |
| 1   | Keep the glass / translucent style?                             | No glass borders. Transparency only over imagery and overlays (chips, scrims, the prompt bar). Surfaces are white at low opacity.                                                                                                                                                                                                                                                                                                                                  | Proposed | Not yet                             |
| 2   | Colour or black and white?                                      | Neutral UI, imagery leads. White primary (one per screen). Colour only for status (running, update, error) and progress. Brand colour only in moments (installer, first run, empty states).                                                                                                                                                                                                                                                                        | Proposed | Not yet                             |
| 3   | Themes                                                          | Light and dark only; no branded purple theme for now.                                                                                                                                                                                                                                                                                                                                                                                                              | Decided  | —                                   |
| 4   | Workflow tabs: top bar in the app, one level lower in a browser | Proposed: the title bar holds only tabs (Home as an icon, one per open workflow and app), where things run and the agent on the right; Create and Build both named. Browser: not yet.                                                                                                                                                                                                                                                                              | Proposed | Tweak                               |
| 5   | Agent blends into the canvas                                    | Open. Direction: the agent is its own panel that pushes the canvas, told apart by place, not colour.                                                                                                                                                                                                                                                                                                                                                               | Open     |                                     |
| 6   | Two homes (ComfyUI from Git / Cloud has none)                   | Open. See Figma "IA · Unified".                                                                                                                                                                                                                                                                                                                                                                                                                                    | Open     |                                     |
| 7   | Install and first-run flow                                      | Proposed: one Set up screen with the checks already run, then install; pick a workflow during the wait; Continue in background and Cancel install apart; ComfyUI opens before models finish; New Instance lists every way in. Look: the Home's latent bloom is the setup's stage (the detected Mac on Set up; during the install it resolves into the picked workflow's image), checks as tiles, phases as a stepper. Audit: Desktop Onboarding Proposal artifact. | Proposed | Tweak (UI Playground › Local setup) |
| 8   | Contrast on weaker monitors                                     | Open. Define 4–5 surface and text levels with measured contrast (`pnpm design:contrast`).                                                                                                                                                                                                                                                                                                                                                                          | Open     |                                     |
| 9   | Spaces vs Projects                                              | Open (needs product, Ryan)                                                                                                                                                                                                                                                                                                                                                                                                                                         | Open     |                                     |
| 10  | Reduce tokens                                                   | Later, with Pablo's token tool                                                                                                                                                                                                                                                                                                                                                                                                                                     | Later    |                                     |

## How decisions land

Decided items go straight into the New UI; Proposed ones are there to
try. Scope follows the milestones (see below).

## One design for every milestone

The New UI is no longer a proposal next to Pablo's: there is no Proposal switch,
and picking a milestone no longer changes the look. Milestones decide what is
there; `mar/` decides how it looks.

- Milestone 0 stays Desktop as it ships, so nothing here touches it (`can.design`).
- Milestone 1 keeps today's dashboard layout, drawn with Home's spotlight, the
  row cards and the toolbars' search field.
- Features follow the same milestones Pablo's pages used: stars and ⌘K from
  Explore, Deployments and Logs from Builder, making apps from Agent. Before
  Agent an app opens as the app, in its tab.
- Explore leads with apps (use cases to run, with an Add button from Explore &
  Learn), and added apps sit in My apps.
- Off the UI Playground, since only Pablo's designs used them: Proposal, Navigation
  › Original, Mode switch › Pill, Build navigation › Current. Off the Prototype
  menu: Customize, only his Agent read it. From Pablo became Nav options.

## Builds milestone: design asks for Ben (2026-11-05)

The Builds milestone now follows `bl/desktop-as-a-platform`: Desktop's build
tabs (Update, Startup Args, Snapshots, Storage, Terminal, About), the header
button with Window options and More, every list state, the list's menu and
right-click, and the sidebar's Builds and Tools. Where the prototype keeps a
different choice, it is a design ask:

| #   | Ask                                                                      | Why                                                                                                          |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| B1  | Builds as one-line rows, not a card grid                                 | Names, state and the one action line up; more builds fit before scrolling.                                   |
| B2  | Start stays the action when an update is waiting; Update is a chip       | Many people keep a build as it is (Pablo). Desktop swaps the button for Update and shrinks Start to an icon. |
| B3  | The action says where it runs: "Start on this computer", "Open on Cloud" | Desktop says only Start / Open; where it runs is otherwise a small icon.                                     |
| B4  | A problem's way out on the row: Locate, Retry install, Finish uninstall  | Desktop shows the red label only; the fix lives in the menu or the build page.                               |
| B5  | Greyed menu items explain themselves in a line at the menu's foot        | Desktop puts "Stop the running instance first." in a tooltip on each greyed item.                            |
| B6  | Startup Args opens on the flag builder, raw arguments on top             | Desktop shows a raw text field and the builder one click away.                                               |

Past the Builds milestone, UI Playground › Sync with previous versions (Off by
default) keeps what Builds can do without changing the later design: a Settings
page per build with Desktop's tabs, opened from More and the Update chip; the
list's problem states on the cards; Remote builds. Migrate stays in Builds.

Builds is one-line rows in every milestone, past Builds too (B1). The other
card looks are gone; UI Playground › Builds view keeps Photos in case the last
things made on a build can be shown later.

Sidebar build counts (the number beside each build) show only from the
milestone where a build lists its workflows (7 · Learn & Recents, its
Workflows tab). Before that a build has no workflows to count. (Design
crit, 2026-11-12.)

## Home build tiles, one build menu, the logs window (2026-11-15)

As shipped in Desktop:

- **Tiles stack when narrow.** Home's builds go up to three across, two below 56rem, one per row below 40rem (the 800px window); every tile keeps one height (`build/BuildTile.vue`).
- **A tile in progress is a tile.** Starting or installing: "Starting ComfyUI · 5%" / "Installing ComfyUI · 40%", the name, `ComfyUI <version>`, a bar along the bottom; no buttons, a click opens its logs.
- **One build menu.** ⋯ on hover or focus, a right-click on the tile and on its sidebar row open the same lines (`build/buildMenu.ts`): what you can do now, Open in new window, the rest greyed when it can't run, Uninstall last, asking inside the menu.
- **The logs window.** Steps in words (Start ComfyUI … Start server; Download, Extract, Set up environment, Get ComfyUI vX), the log across the window under the steps, on its newest line and following it, no Cloud pitch (`setup/BuildProgress.vue`). The full-window install keeps its pitch.

## Catch-up with Desktop's main (2026-11-18)

What merged on Comfy-Org/Comfy-Desktop `main` from 2026-11-14 to 2026-11-18,
by anyone, and what the prototype does now. Open drafts are not followed
until they merge.

- **#2062 Build Overview.** Overview opens the build page, the facts as cards in place of Update and About (`build/BuildOverviewCards.vue`). Added.
- **#2198 Storage second.** Build tabs: Overview, Storage, Startup arguments, Snapshots, Terminal. Updated.
- **#2163 The whole card starts the build.** Home tiles and Builds rows have no Start or Update button: a click starts, opens or shows logs, the hint says which; Update is a grey note. Supersedes asks B2, B3 and B4 above. Updated.
- **#2128 One build menu.** Start, Auto start, the rest, Uninstall last; running: View logs (the build's Terminal), Restart, Stop. Matched.
- **#2147 Every build in its own window.** No Open in new window in the build menu; on the build page a running build is Switch, its caret holds only Stop. Updated.
- **#2174 Upload build.** Signed in, the build menu has Upload build after Restore snapshot. Added.
- **#2179 Copy pass.** Start, build (not instance), sentence case, no em dashes, "Stop the running build first.", Startup arguments. Updated.
- **#2180 New build tile.** With no local build, Home's builds row ends in a New build tile. Added.
- **#2177 Page right-click.** A page in the sidebar right-clicks to Open in new window (`shell/pageMenu.ts`). Added.
- **#2178 Title bar ☰.** Desktop window: Performance tests and Benchmarks only. Build window keeps its longer menu. Updated.
- **#2138 Desktop Settings in the sidebar.** Not added yet: M2's sidebar foot is Pablo's `parts/WorkspaceMenu.vue`; needs a small hook there, to ask.
- **#2175 Desktop Settings › Folders.** Default install location, one Shared folders list, Add models folder. Added.
- **#2176 Set up copy.** "The best settings for your <GPU> are picked. Change any you like.", compact Change setup (`setup/SetupPick.vue`). Updated.
- **#2133 No starter workflow step.** Set up installs what it shows; the Workflow step is gone from every scope. Updated.
- **#2182 Wordmark opening.** Already matched.
- **AppSidebar build percent.** The sidebar row shows the percent of an install or uninstall, not of a start. Updated.
- **#2159, #2146 Title bar.** Middle left empty, Home button, ☰ on the right. Already matched.
- **Apps (Vinh): #2157, #2156, #2202, #2135.** Not changed here; gaps noted for Vinh.
- **Assets (Jaeone): #2204, #2197, #2155, #2143, #2140.** Not changed.
- **#2164 Desktop update in the sidebar.** Not added: main shows it in blue, and the prototype has no blue; to decide with Mar.
- **#2166 Credit balance, #2160 workspace menu.** The prototype already has credits and the workspace at the sidebar's foot.

Pending, not in main (open drafts, not in the prototype): #2181 build picker, #2210 page titles at display size, #2213 live logs window, #2214 sidebar fold (already matched), #2215 Open and Export snapshot on the build page, #2216 update progress on the build, #2217 Folders tab top-down, and the downloads popup proposal.

The prototype has no blue: Run and Resume are white, value fills and status chips grey (see UI-RULES › Buttons and actions).
