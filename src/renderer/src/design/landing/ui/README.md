# Landing prototype UI kit

Small component system for the landing prototype. Mirrors ComfyUI_frontend's
`src/components/ui` conventions so pieces can move across:

- **Reka UI** primitives for every interactive pattern (menus, select, tabs,
  toggle group, dialog, tooltip, switch, checkbox, radio group, accordion,
  toast). Focus, keyboard and ARIA states come from Reka.
- **cva** variant files (`*.variants.ts`) and **`cn()`** (clsx + tailwind-merge,
  taught our custom scales) for class merging.
- Wrappers destructure props with Vue 3.5 defaults: `const { class: className, ...rest } = defineProps()`.

## Tokens (`tokens.css`)

Tailwind v4 `@theme`, imported from `assets/main.css`. Semantic names follow the
frontend (`base-foreground`, `muted-foreground`, `secondary-background`,
`border-default` …). Never use raw colors, radii or shadows in features.

| Scale  | Tokens                                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Text   | `micro` 11 · `meta` 11.5 · `ui` 12.5 · `body` 13 · `heading` 15 · `title` 22 · `display` 34                                  |
| Radius | `panel` 16 · `card` 12 · `control` 8 · `inner` 6 · `min` 4 · `dialog` 20                                                     |
| Shadow | `elev`, `elev-hover`, `glass`, `popover`, `dialog`, `highlight`                                                              |
| Color  | `canvas`, `card-background(-hover)`, `popover-background`, `glass`, `inverted-*`, `media-overlay`, `scrim`, `status-running` |

**Nested radius rule:** inner radius = outer radius − padding between them,
never below `min` (panel 16 /p8 → 8, card 12 /p4 → media 8, menu 12 /p6 → item 6).

## Components

| Pattern    | Component                                                                                    | Notes                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Buttons    | `Button`                                                                                     | `primary` (the one white CTA), `secondary`, `ghost`, `subtle`, `overlay`, `link`; sizes `sm md lg icon-xs icon-sm icon` |
| Text entry | `SearchInput`, `Input`                                                                       | Share `field.variants`; focus ring on the shell, never the native input                                                 |
| Choice     | `Select`, `SegmentedControl`, `Tabs`, `Checkbox`, `Switch`                                   | Select takes `options` + optional muted `label` prefix                                                                  |
| Menus      | `DropdownMenuContent/Item/CheckboxItem/Label/Separator/Sub*`                                 | Use Reka `DropdownMenuRoot`/`Trigger` directly                                                                          |
| Overlays   | `DialogContent`, `PopoverContent`, `Tooltip`, `Toaster`                                      | Portal to `body`, carrying `proto-ui`                                                                                   |
| Surfaces   | `Card` (`elevated`, `glass`, `dashed`, `inset`), `MediaCard`, `Avatar`, `Badge`, `StatusDot` |                                                                                                                         |
| Layout     | `PageHeader`, `SectionHeader`, `EmptyState`, `ScrollRow`                                     |                                                                                                                         |

## Rules

1. One component per pattern. A second search bar is `SearchInput`, not a new one.
2. Interactive elements are styled with utilities only. `main.css` styles bare
   `button`/`input`/`label` and `* { margin; padding }` outside any cascade
   layer; `.proto-ui` hands those properties back to Tailwind, but scoped CSS
   on those elements would be overridden.
3. Never put a `Tooltip` between a Reka `*Root` and its `*Trigger`; wrap the
   whole root with `<Tooltip wrap>` instead (two poppers can't share an anchor).
4. Overlays portal to `body`; floating surfaces carry `proto-ui` themselves.
5. Icons: `lucide-vue-next` (desktop's icon set). The frontend uses Iconify
   classes; swap when porting.
