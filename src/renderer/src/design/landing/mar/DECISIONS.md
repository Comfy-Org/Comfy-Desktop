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

## Home build tiles, one build menu, the logs window (2026-11-15)

As shipped in Desktop:

- **Tiles stack when narrow.** Home's builds go up to three across, two below 56rem, one per row below 40rem (the 800px window); every tile keeps one height (`build/BuildTile.vue`).
- **A tile in progress is a tile.** Starting or installing: "Starting ComfyUI · 5%" / "Installing ComfyUI · 40%", the name, `ComfyUI <version>`, a bar along the bottom; no buttons, a click opens its logs.
- **One build menu.** ⋯ on hover or focus, a right-click on the tile and on its sidebar row open the same lines (`build/buildMenu.ts`): what you can do now, Open in new window, the rest greyed when it can't run, Uninstall last, asking inside the menu.
- **The logs window.** Steps in words (Start ComfyUI … Start server; Download, Extract, Set up environment, Get ComfyUI vX), the log across the window under the steps, on its newest line and following it, no Cloud pitch (`setup/BuildProgress.vue`). The full-window install keeps its pitch.

## Catch-up with Desktop's decisions (2026-11-18)

One line per Desktop PR (Comfy-Org/Comfy-Desktop) and what the prototype does now.

- **#2062 Build overview cards.** The build page opens on Overview with Desktop's cards (`build/BuildOverviewCards.vue`). Added.
- **#2163 The whole row starts a build.** Builds rows have no Start or Update button: a click starts or opens, the hint says which, and Update is a grey note after the meta. Supersedes asks B2, B3 and B4 above. Updated.
- **#2174 Upload build.** Signed in, the build menu has Upload build after Restore snapshot. Added.
- **#2175 Desktop Settings › Folders.** Default install location, Shared folders list, Downloads column, Add models folder. Added.
- **#2176 Set up copy.** "The best settings for your <GPU> are picked. Change any you like.", How to start, Source, Where it is, a compact Change setup (`setup/SetupPick.vue`). Updated.
- **#2177 Page right-click.** A sidebar page opens "Open in new window", plus "Open in new tab" when one window holds tabs (`shell/pageMenu.ts`). Added.
- **#2178 Title bar ☰.** On Home: Performance tests and Benchmarks only. With a build in front: those, then Desktop Settings and Reset Zoom, then Close Window and Quit Desktop. Updated.
- **#2179 Copy pass.** Launch is Start, sentence case, no em dashes, the greyed reason is "Stop the running build first."; Auto start in the menu; no Open in new window (#2147). Updated.
- **#2180 New build tile.** With no local build, Home offers a New build tile next to the others. Added.
- **#2181 Build picker panel.** Not added: the prototype's build pill is a short menu in the tabs title bar, with no picker panel to update. Differs on purpose.
- **#2182 Onboarding centring.** Already matched; Desktop's centring and whiten fixes brought in.
- **#2210 Page titles.** Inter at the display size (34px) on every page; Assets keeps its own title. Updated.
- **#2213 Running logs window.** View logs on a running build opens a live log that follows its newest line. Added.
- **#2214 Sidebar fold.** Already matched: the toggle and the Home row hold their place open or folded.
- **#2215 Running build page.** One Open button; More: Rename, Duplicate, Open Directory, Export snapshot, then Stop, Forget, Uninstall. No back link in M2. Updated.
- **#2216 Updating on the build.** Update runs on the Home tile and the sidebar row with its percent; the build page shows the build updating (`build/BuildUpdating.vue`). Added.
- **#2217 Folders and Startup arguments.** Storage is Folders, second tab (#2198); each section reads top-down with an uppercase title, an info tooltip and a toggle (`build/BuildBlock.vue`); every startup setting is its own row. Updated.
- **Downloads popup (proposal).** The title bar's download icon opens rows: IN PROGRESS and RECENT, a 32px tile, name, size or speed, a 3px bar, pause, retry and cancel in view (`shell/MarDownloads.vue`). Added.
- **Apps (Vinh).** Not changed; its title follows the shared 34px title rule. **Assets (Jaeone).** Not changed.
