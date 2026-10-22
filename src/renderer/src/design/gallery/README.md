# Design gallery (dev only)

A living gallery of the landing prototype's UI kit (`../landing/ui`), modelled
on FeedTLDR's `/design` page, with an inspector to tweak and publish tokens.

Open: http://localhost:5287/src/design/gallery/index.html (preview server:
`node_modules/.bin/vite --config .context/design/vite.config.mts`, which
registers `publish-plugin.mjs`).

## How it works

- **Tabs**: Tokens, Components, Prototype (the real app with the draft).
- **Tweak** (Components tab): a section's Tweak button enters edit mode for
  its component. The inspector shows the tokens behind each part and state;
  kit components let you swap the token a property uses. Esc or Done leaves.
- **Token selected** (Tokens tab, click a sample): edit its value, merge it
  into another token, and see every file that uses it.
  Colors are edited in OKLCH (lightness, chroma, hue, alpha) with an sRGB
  gamut check; `color.ts` has the conversion and ΔE math.
- **Consolidate** (Tokens tab, on Color / Type / Radius / Elevation): starts
  a session for that group in the inspector.
  1. **Rules**: proposed from the group's tokens and usage (minimum font
     size, whole pixels, grid, same value, minimum step, look-alike colors,
     rarely used, one file only, cap the scale). Toggle and tune each; the
     settings persist per group. Rules live in `consolidate/rules.ts`: add
     one entry to `RULES` to add a rule.
  2. **Review**: merges grouped by the token that is kept, value changes,
     and tokens that broke a rule but have no close neighbour ("needs your
     call"). Per row: Keep this (instead), or leave it out.
     Click tokens in the section to merge by hand and pick which one to keep.
     "Add to draft" moves the plan into the draft; Cancel or Esc drops it.
- **Draft**: every change is a draft, kept in localStorage and applied live
  to the gallery and the Prototype view. Copy it (or one token / component)
  as llm.txt with exact code-change steps.
- **Publish** writes the draft to `ui/tokens.css`, the cva variant files,
  and, for merges, every file that uses a merged token. The first write
  backs up the originals to `node_modules/.cache/design-gallery/originals`.
- **Revert all** discards the draft and restores every published file from
  that backup, back to the very beginning.

## Using it in another codebase

Works with any Tailwind v4 theme. Edit `config.ts` only: point
`THEME_SOURCES` at the CSS with your `@theme` blocks and `CODE_SOURCES` at
the code that uses them, and set the repo paths. Every `--name: value` in a
`@theme` block becomes a token, grouped by Tailwind's namespaces
(`theme.ts`: color, font, text, font-weight, tracking, leading, radius,
shadow, blur, ease, animate, breakpoint, container, aspect, …); unknown
namespaces still show, as a value list. Component specimens
(`sections/`) and the cva registry (`inspect/registry.ts`) are the parts
specific to this kit.

## Removing it

Delete this folder and the `galleryPublish()` line in the preview Vite
config. Nothing else imports from here; it only reads `../landing`.
