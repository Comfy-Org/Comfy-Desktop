# The New UI

The look of every prototype milestone from 1 on (`milestones.ts` decides what
is there; this folder decides how it looks). Milestone 0 is Desktop as it ships
and takes nothing from here: everything that writes to `<html>` or watches the
document follows `can.design`. What changed and why is in
[DECISIONS.md](DECISIONS.md).

Milestone 1 keeps today's dashboard layout (`parts/milestones/ClassicDashboard.vue`)
and draws it with this folder's parts. Pablo's earlier designs are on the
prototype branch, draft PR #1782.

## UI and the tuner

The menu's **UI** row opens the UI Playground (⌘.): **Graphite** (the main one; Void, the cool grey before it, stays in Palette) or
the other directions in `ui/looks/`, with live knobs on top of it (corners,
surfaces, borders, shadows), saved per browser. The knobs live in `uiTuner.ts`.
It lists only what changes the screen you're on (`tunerContext.ts`).

## Title bar tweak

Prototype menu › **Title bar**: **Breadcrumb** or **Tabs**
(`shell/titleTabs.ts`), from Milestone 3. Tabs: Home as a fixed icon tab, one tab
per open workflow and app, then where things run (it opens the build switcher)
and the agent on the right. The sidebar's lens switch keeps Create and Build,
both named (`modes/MarModeSeg.vue`, the one mode switch); the agent leaves it.

## Where it lives

The shell is `shell/` (Floating panels by default), the library pages are
`pages/` (handed over by `pages/modes/ModePages.vue`, `pages/owns.ts` lists them),
Home is `MarHomeV10.vue`, Explore `explore/`, Learn `learn/`, a build's page and
Build's pages `build/` and `deploy/`, the agent `agent/`, the menus `menus/`,
motion `motion/`. Shared parts in `ui/` and `parts/` take the look through
`data-mar-ui` (`shell/marShell.css`). The design system pages are at
`/src/design/landing/mar/ds/index.html`.

## Sync with Pablo's branch

`scripts/design/sync-pablo.sh` merges `origin/PabloWiedemann/instances-landing-prototypes`
into the current branch. It never rewrites history and stops on a conflict.
New features there arrive in Pablo's pages, so port them to this folder's.
