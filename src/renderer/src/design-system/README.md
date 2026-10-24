# Design system

The desktop's component system. It mirrors ComfyUI_frontend's `src/components/ui` conventions, so pieces can move across:

- **Reka UI** primitives for every interactive pattern (menus, select, tabs, toggle group, tooltip). Focus, keyboard and ARIA states come from Reka.
- **cva** variants and **`cn()`** (clsx + tailwind-merge, taught the custom scales) for class merging.
- Wrappers destructure props with Vue 3.5 defaults: `const { class: className, ...rest } = defineProps()`.

Add a component when a screen needs it, and only the variants that screen uses.

## Tokens (`tokens.css`)

Tailwind v4 `@theme static`: every variable is emitted, so legacy scoped CSS can read `var(--…)` too. Never use raw colors, radii, shadows or font sizes in features.

| Scale  | Tokens                                                                                                                                                                                                                                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Color  | `app-background`, `content-background`, `card-background(-hover)`, `secondary-background(-hover)`, `base-foreground`, `muted-foreground`, `subtle-foreground`, `inverted-background(-hover)`, `inverted-foreground`, `border-default`, `border-strong`, `border-focus`, `media-overlay`, `status-running`, `status-warning`, `status-danger` |
| Text   | `ui` 13/20 · `heading` 16/24 · `title` 22/28 · `display` 34/40                                                                                                                                                                                                                                                                               |
| Radius | `panel` 16 · `card` 12 · `control` 8 · `min` 4                                                                                                                                                                                                                                                                                               |
| Shadow | `elev`, `elev-hover`, `popover`, `highlight`                                                                                                                                                                                                                                                                                                 |
| Other  | `ease-out-expo` · `animate-pop-in` · `animate-fade-in` · `animate-status-pulse` · `animate-shimmer`                                                                                                                                                                                                                                          |

**4px grid:** every size, line-height and control height is a multiple of 4; font sizes are the exception.

**Nested radius:** inner radius = outer radius − padding between them, never below `min` (panel 16 /p8 → control 8, card 12 /p4 → media 8, menu 12 /p4 → item 8).

## Surfaces (`surfaces.css`, `base.css`)

| Class / utility    | Use                                                                   |
| ------------------ | --------------------------------------------------------------------- |
| `.ds-root`         | The scope: hands bare-element styles from `main.css` back to Tailwind |
| `.ds-page`         | The glass page (dashboard window body)                                |
| `.glass-titlebar`  | The top of the same glass, on the dashboard window's title bar        |
| `.ds-content`      | The inset content panel: overhead light, teal and plum mesh, glow     |
| `edge-shine`       | Card edge highlight (`Card variant="elevated"`)                       |
| `heading-gradient` | Display headings                                                      |
| `scrollbar-quiet`  | Thin scrollbars on the app's scrolling regions                        |

The gradient values were tuned visually. Do not change them without design.

## Components

| Pattern    | Component                                                              | Notes                                                                                                 |
| ---------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Buttons    | `Button`                                                               | `primary` (the one white CTA per surface), `secondary`, `ghost`, `link`                               |
| Text entry | `SearchInput`, `Input`                                                 | Share `fieldClass`; focus ring on the shell, never the native input                                   |
| Menus      | `DropdownMenuContent/Item/Label/Separator/SubTrigger/SubContent`       | Use Reka `DropdownMenuRoot`/`Trigger` directly                                                        |
| Overlays   | `Tooltip`                                                              | Needs a Reka `TooltipProvider` above it                                                               |
| Surfaces   | `Card` (`elevated`, `dashed`, `inset`), `Avatar`, `Badge`, `StatusDot` | `StatusDot`: `running` and `ready` (green) and `busy` (amber) pulse; `error` red; `idle` the quietest |
| Identity   | `LocationIcon`                                                         | The one this-computer / Comfy Cloud mark                                                              |
| Lists      | `ListTable`                                                            | Rows with a column header in a card; skeleton rows while loading                                      |
| Loading    | `Skeleton`                                                             | Sized like the content it stands in for; the loading region carries `role="status"` and a label       |
| Renaming   | `InlineEdit`                                                           | Text that becomes a field in its own type style; Enter or blur saves, Escape cancels                  |

## Rules

1. One component per pattern. A second search bar is `SearchInput`, not a new one.
2. Components take their user-facing text as props; they never hold English strings.
3. Interactive elements are styled with utilities only. `main.css` styles bare `button`/`input`/`label` and `* { margin; padding }` outside any cascade layer; `.ds-root` hands those properties back to Tailwind, but scoped CSS on those elements would be overridden.
4. Overlays portal to `body`; floating surfaces carry `ds-root` themselves.
5. Icons: `lucide-vue-next`.
6. Legacy screens get the palette through `assets/palette-void.css`, not through this folder.
