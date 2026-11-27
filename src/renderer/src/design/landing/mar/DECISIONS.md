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
milestone where a build lists its workflows (7 · Recents & Assets, its
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

## Week of 2026-11-24: onboarding, Create, Home and edge cases

Mar's decisions from 2026-11-23 to 2026-11-27. Where two contradict, the
later one stands and the earlier one is left out. Milestone 13 is the
internal `m=8.5`. "Tweak" means it is in the UI Playground to compare.

### How we work

- **New ideas go in as tweaks**, never over what is there. Don't move or restyle controls nobody asked to change.
- **Reuse before inventing:** the prototype's design system first, then Desktop's main and prod, then shadcn. No new primitives.
- **Follow prod when unsure:** where the prototype added behaviour prod doesn't have, it goes, unless it clearly helps.
- **Figma and FigJam are in English.** The FigJam flows show the happy path only, the edge cases sit apart, and each edge case shows one solution: the best one.
- **PRs to Desktop are small** and only use what the backend already has. A visual PR needs before/after screenshots. Vinh (vqt123) reviews.

### Milestones

- **Milestone 7 is Recents & Assets.** Learn moves to milestone 8.
- **Milestone 13** is the onboarding milestone. It has no Search in the sidebar; ⌘K still opens search.
- **Explore** has two tabs only: Apps and Workflows.

### Home (milestone 13)

- **Default layout:** "Recents first", with the smart search under the title, then Recently used, then Explore. The Home banner is hidden.
- **Explore strip:** Explore uses main's card interaction: the arrow in the corner, and the title and subtitle on hover.
  - The header reads "EXPLORE ›" and opens Explore on the tab that is showing.
  - Workflows | Apps is a subtle switch, with Workflows first and picked by default. Its style is a tweak; the segmented control is the default.
  - Headers have no background; the text and arrow carry the highlight.
- **Sliders:** no fade at the sides, and they cut where the other sliders cut. Rounded cards keep their corners. Arrows follow one rule everywhere.
- **Recently used** shows the generic workflow thumbnail, plus a small local or Cloud icon before the build name.
  - Section titles are uppercase.
  - A recent opens straight into its ComfyUI tab, with no modal.
- **Workflow covers:** default to the canvas cover in milestone 13.
- **Spacing:** the blocks breathe (14px above the search, 24px below). Templates start 32px below the search.
- **Removed ideas:** the discarded Home ideas are gone. Only compact Recents and the small greeting stay as tweaks.

### Search, Create and the blank canvas

- **One smart search:** the same component on Home and in Create.
  - It describes or searches ("Describe what you want to make, or search templates and apps").
  - It has a faint border and no shadow.
  - It is not focused on open.
- **Agent:** sending to the agent opens its panel at full height on the right. The canvas, toolbars and Run move left, and nothing is covered.
- **No-match results:** Ask the agent is a polished row under the results. "Also try" follows.
- **Create's default is V15** ("Canvas start"). V16 stays as an option: smart search, a centred title, no tabs, and a template band.
  - Create has no × of its own; it closes from its tab. Esc still closes it.
  - The dot grid fades out at the edges, sides included, and also while a graph preview shows.
  - Exiting a graph preview is easy: a pill with Open and ✕.
- **Template cards:** picking a template, from a tile, a search result or the best match, opens the template modal. Graph on hover is a tweak, off by default.
- **Blank canvas:**
  - The card is a dashed outline with a soft fill, a step lighter on hover.
  - It opens an empty canvas.
  - The node and template search panel ("Search nodes and templates") is a tweak.

### Template modal

- **Readiness lives in the modal,** never on thumbnails or cards: "Ready", "Needs X GB", "Runs on Cloud".
- **Missing models are shown before opening.** The button says "Download and open", or "Open" when nothing is missing.
  - Recents, Open workflow and dropped files open directly. If something is missing there, ComfyUI's missing-models dialog appears, as in prod.
- **Templates never run by themselves.** ComfyUI opens with the template loaded, Run is highlighted once, and "Press Run…" shows. The first-result card is gone, as in prod.
- **No ratings or stars on workflows.**
- **Under exploration as tweaks:**
  - Template details: Current (default), Compact, and the Split / Checklist / Tabs proposals.
  - Template feed: Off (default), Feed, and Strip.
- **Can't-run cases:** the Playground has a "Can't-run case" select. Picking a case turns the edge case off.

### Edge cases (Playground › Edge case, share key `edge`)

Each problem is stated once, with one way out.

- **E1 · Offline at first launch:** the offline note sits in a tray that slides out from behind Try again, and the install retries on its own once back online.
- **E2 · Download fails:** Try again. The Cloud button says what happens next: Log in to run on Cloud, Get credits, or Pick another build.
- **E3 · Disk full:** one warning card, "Not enough space · Needs N GB more".
  - Choose another drive is the primary; Free up space opens the list of models to remove inside the card.
  - Once there's room, the card turns green and Try again comes back.
- **E5 · Start fails twice:** Repair build (primary), Restart, Copy error report, Open Terminal, Back to Home.
- **E6 · Models that can't download:** the missing-models dialog has two groups, "Downloads automatically · N GB" and "Needs you".
  - Each model in "Needs you" has Find it (Civitai, Hugging Face) and I have it.
  - The dialog closes with Open anyway or Download N GB, and the missing node shows in red on the canvas.
- **E9 · Install fails:** a plain reason, Try again, and Use Cloud instead.
- **E10 · This computer can't run models locally:** setup says so before installing. Use Comfy Cloud is the primary, Install anyway the secondary.
- **E11 · No Cloud credits:** Get credits opens the credits sheet.
- **E12 · Login fails:** an error toast, "Couldn't log in", with Try again. Closing it continues without an account.
- **Credits:** buying credits is only shown to a new user with no subscription: account, permissions, then credits, all in the browser. Returning users never see a top-up.

### Feedback, dialogs and type

- **One toast:** Mar's toast, top right under the title bar.
  - It comes in tones: red when something failed, orange to take care, green when it went well, neutral otherwise.
  - It has at most one action, and the × closes it.
  - The AI agent nudge and the login failure use it too. The nudge sits below the canvas's Run toolbar. Whether every toast should drop below it on a canvas is still open.
- **Modals:** the round × sits outside the card. A modal footer keeps its line.
- **Asset details:** the × stays beside More, as it was.
- **Modal titles** are 18px semibold (`text-subtitle`, a new step in the type scale: 13 · 16 · 18 · 22 · 34). shadcn is the reference for components, but type sizes always come from our scale.
- **Sidebar motion** follows Desktop's main; Snap is a tweak.
- **Version shown:** the starting screen shows the ComfyUI version setup installed (v0.42.4).
