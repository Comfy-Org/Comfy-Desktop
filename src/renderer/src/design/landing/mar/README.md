# Mariana's proposal

Lives apart from Pablo's prototype. Pick it in the Prototype menu
(Proposal: Pablo or Mar, the first section) or open the preview with
`?proposal=mariana`.

Mar's proposal always shows Pablo's latest milestone (first run included,
which keeps his example cards). Picking another milestone switches to
Pablo's at that milestone. What changed and why is in
[DECISIONS.md](DECISIONS.md).

## UI and the tuner

The menu's **UI** section picks the look: **Void** (the main one) or the
other directions in `ui/looks/`. **Tune the UI…** opens a panel with live
knobs on top of it (corners, surfaces, borders, shadows), saved per browser. The knobs live in `uiTuner.ts`.

## Title bar tweak

Prototype menu › **Title bar**: **Breadcrumb** (Pablo's) or **Tabs**
(`shell/titleTabs.ts`). Tabs: Home as a fixed icon tab, one tab per open
workflow and app, then where things run (it opens the build switcher) and
the agent on the right. The sidebar's lens switch keeps Create and Build,
both named (`modes/MarModeSeg.vue`, the one mode switch); the agent leaves it.

## What it changes

Mar's draft follows Figma "Exploration 17 · Ambient dock":

- No sidebar: one floating dock at the bottom (`shell/MarDock.vue`) with
  the pages, the recent builds and their state, projects and spaces in a
  flyout, the workspace, and the Create / Build / Agent switch at the end,
  like Figma's mode switch. In Build it shows Build's pages.
- Home: a tall page photo with a large greeting, the Create menu top
  right, a compact prompt box, recent work as photo cards, What's new as
  tabs. Example workflows live in Agent, not on Home.
- Agent: Mar's chat (`agent/MarAgent.vue`) over the same scripted flows.
- Chips on images are dark grey with a blur; tabs slide; micro-animations
  live in `motion/`.

## How it stays apart

Everything new is in this folder. Pablo's files only gain small hooks:

- `prototypeOptions.ts`: the Proposal, UI and Tune groups, and Title bar.
- `comfyTitleBar/TitleBarApp.vue`: the Prototype menu shows a heading per
  section, with Proposal first.
- `LandingPrototypes.vue`: mounts the UI tuner.
- `pages/modes/ModePages.vue`: Home goes through `HomeEntry.vue`.
- `variants/VariantModes.vue`: the Agent icon comes from `proposal.ts`;
  with Title bar › Tabs, the lens switch is `MarModeSeg.vue`.
- `parts/nav/TitleBarBreadcrumb.vue`: shows `MarTitleTabs.vue` instead
  while Title bar › Tabs is on.
- `titleBar.ts`, `titleBarBridge.ts`: publish the tabs and take their
  clicks (tab, close tab, agent).

With Proposal: Pablo, the prototype is exactly his.

## Daily sync with Pablo's branch

`scripts/design/sync-pablo.sh` merges `origin/PabloWiedemann/instances-landing-prototypes`
into the current branch. It never rewrites history and stops on a conflict.
