# Looks: directions and themes

A workbench for exploring the visual design on the real prototype screens,
before any token is renamed or removed. Pick the look in the **Prototype**
menu (title bar in the app, bottom-left in the browser preview):

- **Direction:** Original (the approved prototype, untouched), A, B, C.
- **Theme:** Dark, Light.

Both are attributes on `<html>` (`data-ds-direction`, `data-ds-theme`), set
by `look.ts` and shared with the title bar windows. Links can force a look:
`design-landing.html?direction=a&theme=light`.

## Working on a direction

1. Open `direction-a.css` (or b, c).
2. Override token values: dark values in the first block, light values in
   the second. Leave a token out to keep Original's value.
3. Switch to that direction in the Prototype menu and compare.

Rules:

- Only change values. Components and token names stay as they are until a
  direction is approved; mapping and pruning tokens comes after.
- Give every override a light and a dark value.
- Throwing a direction away is emptying its file.

## The knobs

| Group | Tokens |
| --- | --- |
| Surfaces | `--color-app-background`, `--color-content-background`, `--color-card-background`, `--color-card-background-hover`, `--color-secondary-background`, `--color-secondary-background-hover`, `--color-titlebar-background`, `--color-media-overlay` |
| Text | `--color-base-foreground`, `--color-muted-foreground`, `--color-subtle-foreground` |
| Accent | `--color-inverted-background`, `--color-inverted-background-hover`, `--color-inverted-foreground` |
| Borders | `--color-border-default`, `--color-border-strong`, `--color-border-focus` |
| Status | `--color-status-running`, `--color-status-danger` |
| Type | `--text-ui`, `--text-heading`, `--text-title`, `--text-display` (and their `--line-height`), `font-family` on `.proto-ui` |
| Shape | `--radius-min`, `--radius-control`, `--radius-card`, `--radius-panel` |
| Depth | `--shadow-elev`, `--shadow-elev-hover`, `--shadow-popover`, `--shadow-highlight`, `--blur-glass` |
| Glass | `--glass-base`, `--glass-sheen`, `--glass-warm`; the page and content panel backgrounds (`.proto-shell`, `.proto-main`, see `light.css` for how to override them) |

## Checking the work

Run from the repo root (first time: `pnpm exec playwright install chromium`).

| Command | What it does |
| --- | --- |
| `pnpm design:preview` | Opens the prototype in the browser, no Electron needed. |
| `pnpm design:shots --name before` | Screenshots every direction × theme (Milestones 1 and 4 by default) into `design-shots/before/`, with an `index.html` to compare. |
| `pnpm design:shots --against before` | Same, plus what changed since `before`, painted red. |
| `pnpm design:contrast` | WCAG contrast of every text role on every surface, per direction and theme. Below 4.5:1 is a fail. |

Options: `--directions original,a`, `--themes light`, `--milestones 1,2,4,10`.

## Known gaps

- `light.css` is a neutral starting point, not a proposal.
- The title bar and its popups in the Electron app are drawn by
  `assets/chrome-void.css` on the legacy variables, so they follow the
  direction's tokens only partly and ignore the light theme.
- Some components paint raw white or black (mostly thumbnails over
  imagery in the Agent and Apps milestones, plus `ui/Avatar.vue` and
  `ui/Checkbox.vue`). They don't follow the theme yet.
