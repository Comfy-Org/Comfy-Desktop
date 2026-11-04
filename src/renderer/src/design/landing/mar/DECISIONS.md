# Decisions

Open questions from the design-system kickoff with Pablo (2026-10-26) and
where each one stands. "In Mar" says whether it is already in the prototype
("Tweak": in the Prototype menu, to compare).

| #   | Question                                                        | Decision                                                                                                                                                                                    | Status   | In Mar  |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| 1   | Keep the glass / translucent style?                             | No glass borders. Transparency only over imagery and overlays (chips, scrims, the prompt bar). Surfaces are white at low opacity.                                                           | Proposed | Not yet |
| 2   | Colour or black and white?                                      | Neutral UI, imagery leads. White primary (one per screen). Colour only for status (running, update, error) and progress. Brand colour only in moments (installer, first run, empty states). | Proposed | Not yet |
| 3   | Themes                                                          | Light and dark only; no branded purple theme for now.                                                                                                                                       | Decided  | —       |
| 4   | Workflow tabs: top bar in the app, one level lower in a browser | Proposed: the title bar holds only tabs (Home as an icon, one per open workflow and app), where things run and the agent on the right; Create and Build both named. Browser: not yet.       | Proposed | Tweak   |
| 5   | Agent blends into the canvas                                    | Open. Direction: the agent is its own panel that pushes the canvas, told apart by place, not colour.                                                                                        | Open     |         |
| 6   | Two homes (ComfyUI from Git / Cloud has none)                   | Open. See Figma "IA · Unified".                                                                                                                                                             | Open     |         |
| 7   | Install and first-run flow                                      | Open                                                                                                                                                                                        | Open     |         |
| 8   | Contrast on weaker monitors                                     | Open. Define 4–5 surface and text levels with measured contrast (`pnpm design:contrast`).                                                                                                   | Open     |         |
| 9   | Spaces vs Projects                                              | Open (needs product, Ryan)                                                                                                                                                                  | Open     |         |
| 10  | Reduce tokens                                                   | Later, with Pablo's token tool                                                                                                                                                              | Later    |         |

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
