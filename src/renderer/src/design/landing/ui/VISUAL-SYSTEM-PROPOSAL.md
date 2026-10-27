# Proposal: visual rules and structure for the design system

Draft by Mar, for discussion with Pablo. Based on an audit of the prototype
(`src/renderer/src/design/landing/`, 168 Vue components, commit `2eae4fd`).

## 1. Findings

| Area | Today | Problem |
| --- | --- | --- |
| Text color | `subtle` 281 uses, `muted` 210, `base` 88 | The dimmest grey is the most used, so almost everything reads at the same (low) level. |
| Contrast | `subtle` on card: 4.3:1; on card hover: 3.9:1 | Below AA (4.5:1) for 13px text. It gets lost on monitors worse than a Mac's. |
| Type sizes | `text-ui` (13px) 577 uses; heading 31, title 24, display 8; 17 one-off sizes (`text-[9px]`, `10.5px`, `14px`, `15px`, `22px`, `24px`, `28px`, `30px`, `40px`) | One size does almost all the work and special cases are set by hand. `text-body`, `micro` and `meta` appear in the README or the code but don't exist in `tokens.css`. |
| Weights | medium 111, semibold 83, normal 15, bold 6 | Four weights, no rule for when to use each. |
| Raw colors | ~50 uses of `bg-white/10`, `bg-black/30`, `text-white`… and 140 color literals in 23 files | Outside the system: they don't follow the theme. Some are legitimate (mock data, macOS traffic lights, app themes). |
| Spacing | `gap-1.5`, `gap-2.5`, `gap-3.5`, `px-2.5`… used a lot | Half steps (6, 10, 14px) that break the 4px grid the dev plan asks for. |
| Radii | `control`/`card`/`panel`/`min` + 23 one-off values (`1px`, `2px`, `3px`, `4px`, `7px`, `28%`) | The nested-radius rule exists but isn't followed everywhere. |
| Themes | Dark only. Values live directly in `@theme`; `secondary-background` and borders are white with alpha | No structure for light: white with alpha doesn't invert. |
| Surfaces | Glass, panel and glow with literal `oklch(...)` in `surfaces.css` | Beautiful, but neither themeable nor explainable as a rule. |

## 2. Proposed structure: three layers

```
Primitives  ->  Semantic (per theme)  ->  Component (only if needed)
gray-1..12      surface-*, text-*,         button, card...
red, green,     border-*, accent           read semantic tokens, never primitives
amber, brand
```

1. **Primitives.** One 12-step neutral ramp in oklch (hue 285, low chroma, as
   today) plus the functional colors (red, green, amber). One set for dark,
   one for light. Features never use them directly.
2. **Semantic.** The names the code already uses (`base-foreground`,
   `muted-foreground`, `card-background`…), pointing at a primitive per
   `[data-ds-theme='dark' | 'light']`. Same name, two values.
3. **Component.** Only when a role can't be expressed with a semantic token.
   Hover and selected are derived (`color-mix`), not new tokens.

### 2.1 Surface levels (elevation)

Four levels, each with a background, border and shadow defined per theme:

| Level | Token | Where |
| --- | --- | --- |
| 0 · Window | `app-background` | Glass page, sidebar, title bar |
| 1 · Content | `content-background` | The main scrolling panel |
| 2 · Raised | `card-background` | Cards, inputs, controls on the content |
| 3 · Floating | `popover-background` (new) | Menus, popovers, dialogs, tooltips |

Rule: an element only sits on its own level or the one below. No card on a
card on a card.

### 2.2 Text: three roles with a clear use

| Role | Use | Minimum contrast |
| --- | --- | --- |
| `base-foreground` | Titles, labels, what is read first | 7:1 |
| `muted-foreground` | Body and descriptions (the default) | 4.5:1 |
| `subtle-foreground` | Metadata only (dates, counts, hints) | 4.5:1 on every level |

Concrete change: raise `subtle` until it passes 4.5:1 on
`card-background-hover`, and move the uses of `subtle` that aren't metadata
to `muted`.

### 2.3 Type: five sizes, three weights

| Token | Size / line height | Use |
| --- | --- | --- |
| `text-meta` | 12 / 16 | Metadata, badges, counts |
| `text-ui` | 13 / 20 | Interface and body (default) |
| `text-heading` | 16 / 24 | Section and card titles |
| `text-title` | 22 / 28 | Page title |
| `text-display` | 34 / 40 | Home greeting, hero |

Weights: `normal` (body), `medium` (labels, buttons, navigation), `semibold`
(titles). No `bold`. No arbitrary sizes. Font: Inter, as in the prototype.

### 2.4 Space and shape

- **Spacing:** 4px grid. Allowed scale: 4, 8, 12, 16, 24, 32, 48
  (`1, 2, 3, 4, 6, 8, 12`). No half steps.
- **Radii:** `min` 4 · `control` 8 · `card` 12 · `panel` 16 · `full` (pills
  and avatars). Inner radius = outer radius − padding, never below `min`.
- **Icons:** lucide, three sizes (14, 16, 20).

### 2.5 Light and dark

- Every semantic token has a value in both themes; if one is missing, it
  doesn't ship.
- Alpha colors are defined over the theme's text color
  (`color-mix(in oklab, var(--color-base-foreground) 8%, transparent)`), not
  over fixed white, so they invert on their own.
- Glass and gradients become tokens (`--glass-*`, `--glow-*`) with a version
  per theme. In light the glass is simplified (no color mesh) until we
  validate it.

## 3. Rules

1. Only semantic tokens in features: no `white/10`, `oklch()` or hex.
2. One surface per level; no element skips levels.
3. One primary CTA (`inverted`) per screen.
4. `subtle` is for metadata only.
5. Five text sizes, three weights.
6. Spacing on the 4px grid.
7. Radii from the scale; nested with the subtraction rule.
8. Every token exists in light and dark.
9. AA contrast minimum (4.5:1 text, 3:1 control borders) in both themes.
10. Hover and selected are derived; no tokens per state.

## 4. Order of work

Design first, tokens after approval:

1. Explore two or three visual directions on a few key screens (Milestone 1
   dashboard, Milestone 4 Home, a menu or dialog), in light and dark, using
   the Direction and Theme switches (`ui/looks/`).
2. Review with Pablo and pick one.
3. Write the final rules from the approved direction.
4. Map it to tokens, prune what is left over, and structure light and dark.

## 5. To decide with Pablo

- Does this land in Milestone 1 or as an iteration after the approved system?
- Do the glass and the color mesh stay in light?
- Do we align these names with ComfyUI_frontend and the "Comfy Design System"
  Figma library, for one shared vocabulary?
