<script setup lang="ts">
import { computed } from 'vue'
import { byValue, isDefault, LEVELS, snippet, USES, type Snippet } from '../materials'

/**
 * Materials · Blur, the part that doesn't change with the theme: who uses
 * each level, the rules, the CSS as it is in the code now, and a proposal
 * to consolidate it. Shown under the theme frames (DsApp.vue).
 */
type Ref = [file: string, needle: string, nth?: number, whole?: boolean]
const SNIPPETS: Record<string, Ref[]> = {
  menu: [
    ['mar/menus/layers.css', "[role='menu']", 0],
    ['mar/menus/layers.css', "[role='menu']", 1],
    ['mar/shell/marShell.css', 'blur(28px) saturate(1.3)']
  ],
  palette: [
    ['mar/search/search.css', '.mar-search {'],
    ['mar/search/search.css', "[data-ds-theme='light'] .mar-search {"]
  ],
  tooltip: [
    ['mar/shell/marShell.css', '.mar-tip {', 0],
    ['mar/shell/marShell.css', '.mar-tip {', 1]
  ],
  modal: [['mar/templateModal/templateModal.css', 'blur(32px) saturate(1.3)']],
  scrim: [
    ['mar/templateModal/templateModal.css', '.mar-tpl-scrim {'],
    ['mar/templateModal/templateModal.css', "[data-ds-theme='light'] .mar-tpl-scrim"],
    ['ui/DialogContent.vue', 'backdrop-blur-[3px]', 0, false]
  ],
  bar: [['mar/pages/MarSelectBar.vue', '.mar-selbar {']],
  chip: [
    ['ui/tokens.css', '--color-media-overlay', 0, false],
    ['mar/shell/marShell.css', '--color-media-overlay', 0, false],
    ['mar/pages/MarStatus.vue', '.on-media {'],
    ['mar/MediaChip.vue', 'backdrop-blur-md', 0, false],
    ['ui/badge.variants.ts', 'backdrop-blur-sm', 0, false]
  ],
  composer: [['mar/shell/marShell.css', '.mar-prompt.bg-card-background']],
  control: [
    ['mar/shell/marShell.css', 'blur(16px) saturate(1.2)'],
    ['mar/shell/marShell.css', 'backdrop-filter: blur(16px);', 0],
    ['mar/shell/marShell.css', 'backdrop-filter: blur(16px);', 1]
  ],
  card: [
    ['mar/shell/marShell.css', '.proto-main .bg-card-background {'],
    ['mar/pages/MarItem.vue', '.mar-item.is-grid {']
  ],
  panel: [['mar/shell/MarSidebar.vue', 'blur(40px) saturate(1.3)']],
  titlebar: [
    ['mar/shell/marShell.css', 'backdrop-filter: none;', 0],
    ['mar/shell/marShell.css', '> .glass-titlebar {']
  ],
  toast: [['mar/pages/MarUndoToast.vue', 'backdrop-filter', 0, false]]
}
/** Details: who uses what, rules, performance. Code: the CSS. */
const { part = 'details' } = defineProps<{ part?: 'details' | 'code' }>()
const snippets = (id: string): (Snippet | { missing: string })[] =>
  (SNIPPETS[id] ?? []).map(
    ([file, needle, nth, whole]) =>
      snippet(file, needle, nth, whole) ?? { missing: `${file}: “${needle}” has moved` }
  )

const inDefault = computed(() => USES.filter(isDefault))
const repeated = computed(() => byValue(inDefault.value).filter((g) => g.uses.length > 1))
const elsewhere = computed(() => USES.length - inDefault.value.length)

const PROPOSAL = `/* Proposal, not in the app: one place for every material
   (mar/shell/materials.css, loaded before marShell.css). Same values as
   today; the comments say where the scale would round them. */
:root[data-mar-ui='on'] {
  /* The blur scale. */
  --mar-blur-scrim: 6px;
  --mar-blur-chip: 12px;    /* Pablo's overlays use 8 (backdrop-blur-sm) */
  --mar-blur-control: 16px;
  --mar-blur-tip: 20px;
  --mar-blur-surface: 24px; /* cards today; gone if cards go solid */
  --mar-blur-prompt: 28px;
  --mar-blur-float: 32px;   /* menu, modal; the select bar's 30 → 32 */
  --mar-blur-max: 40px;     /* palette, sidebar: the ceiling */

  /* Shared pieces. */
  --mar-glass-ink: var(--color-base-foreground);
  --mar-glass-ring: inset 0 0 0 1px color-mix(in oklch, var(--mar-glass-ink) 7%, transparent);
  --mar-glass-lift: 0 1px 2px rgb(0 0 0 / 0.2);
  --mar-glass-drop-sm: 0 8px 24px -8px rgb(0 0 0 / 0.5);
  --mar-glass-drop-md: 0 18px 48px -16px rgb(0 0 0 / 0.65);
  --mar-glass-drop-lg: 0 32px 80px -24px rgb(0 0 0 / 0.7);

  /* A glass surface: ink tint in the card colour, then its opacity. */
  --mar-glass-menu-tint: 6%;
  --mar-glass-menu-alpha: 74%;
  --mar-glass-menu-saturate: 1.8;
  --mar-glass-palette-tint: 6%;
  --mar-glass-palette-alpha: 86%;
  --mar-glass-palette-saturate: 1.8;
  --mar-glass-tip-tint: 8%;
  --mar-glass-tip-alpha: 94%;
  --mar-glass-modal-tint: 5%;
  --mar-glass-modal-alpha: 90%;
  --mar-glass-bar-tint: 8%;
  --mar-glass-bar-alpha: 88%;
  --mar-glass-saturate: 1.3; /* tooltip, modal, bar */
  --mar-glass-chip: var(--color-media-overlay); /* dark 60%, both themes */
  --mar-scrim: rgb(0 0 0 / 0.5);
}
:root[data-mar-ui='on'][data-ds-theme='light'] {
  --mar-glass-menu-tint: 3%;
  --mar-glass-menu-alpha: 78%;
  --mar-glass-menu-saturate: 1.6;
  --mar-glass-palette-tint: 2%;
  --mar-glass-palette-alpha: 84%;
  --mar-glass-palette-saturate: 1.6;
  --mar-glass-modal-alpha: 94%; /* the wizard's light value */
  --mar-glass-drop-sm: 0 8px 24px -10px rgb(0 0 0 / 0.18);
  --mar-glass-drop-lg: 0 28px 64px -20px rgb(0 0 0 / 0.28);
  --mar-scrim: rgb(20 20 30 / 0.22);
}

/* One mixin per level, e.g. the menu: */
.mar-glass-menu {
  border-radius: 14px;
  padding: 6px;
  background-color: color-mix(
    in oklch,
    color-mix(in oklch, var(--mar-glass-ink) var(--mar-glass-menu-tint), var(--color-card-background))
      var(--mar-glass-menu-alpha),
    transparent
  );
  backdrop-filter: blur(var(--mar-blur-float)) saturate(var(--mar-glass-menu-saturate));
  box-shadow: var(--mar-glass-ring), var(--mar-glass-lift), var(--mar-glass-drop-md);
}`

const FALLBACK = `/* Not in the app today. Where glass can't blur, or the person asked
   for less transparency, every glass goes opaque: same colours. */
@supports not (backdrop-filter: blur(1px)) {
  :root[data-mar-ui='on'] {
    --mar-glass-menu-alpha: 100%;
    --mar-glass-palette-alpha: 100%;
    --mar-glass-tip-alpha: 100%;
    --mar-glass-modal-alpha: 100%;
    --mar-glass-bar-alpha: 100%;
    --mar-glass-chip: oklch(0 0 0 / 0.72);
  }
}
@media (prefers-reduced-transparency: reduce) {
  :root[data-mar-ui='on'] {
    --mar-glass-menu-alpha: 100%;
    --mar-glass-palette-alpha: 100%;
    --mar-glass-tip-alpha: 100%;
    --mar-glass-modal-alpha: 100%;
    --mar-glass-bar-alpha: 100%;
    --mar-glass-chip: oklch(0 0 0 / 0.72);
    --mar-scrim: rgb(0 0 0 / 0.7);
  }
  :root[data-mar-ui='on'] * {
    backdrop-filter: none !important;
  }
}`
</script>

<template>
  <article class="ds-doc ds-mat-doc">
    <template v-if="part === 'details'">
      <h2>Who uses which level</h2>
      <div class="ds-mat-uses">
        <template v-for="l in LEVELS" :key="l.id">
          <strong>{{ l.name }}</strong>
          <span
            >{{ l.usedBy }}<br /><code>{{ l.defined }}</code></span
          >
        </template>
      </div>

      <h2>Rules</h2>
      <ul>
        <li>
          <strong>Blur only on what floats over content</strong>: menus, selects, popovers,
          tooltips, the ⌘K palette, modals and their scrim, the select bar, chips on a picture. What
          sits in the page (cards, rows, sections, the toolbar) is a solid surface: the foreground
          at low opacity or the card colour, no <code>backdrop-filter</code>.
        </li>
        <li>
          <strong>Cards on the page blur today:</strong>
          <code>.proto-main .bg-card-background</code> and <code>.mar-surface</code> at 24px,
          <code>.mar-item.is-grid</code> at 20px. Proposal: drop it, so a grid stops paying for a
          blur per card while it scrolls.
        </li>
        <li>
          <strong>40px is the ceiling</strong> (palette, sidebar). Past it nothing looks different
          and it costs more. Saturate goes with the blur: 1.2–1.3 for surfaces, 1.8 only for menus
          and the palette (1.6 in light).
        </li>
        <li>
          <strong>Glass is mostly opaque</strong>: 74% (menus, dark) to 94% (tooltips). Below that,
          text can't hold its contrast over a bright picture. Chips on pictures use
          <code>--color-media-overlay</code>, a dark 60% (the New UI value over the base 55% black),
          in both themes. Its coloured status words fall to about 3.5:1 over a white picture; the
          words could go white there, with the colour kept in the icon.
        </li>
        <li>
          <strong>No blur inside blur.</strong> What sits on glass (the menu's raised panel
          <code>.mar-menu-panel</code>, its current pick, the palette's list) is a tint only, with
          <code>backdrop-filter: none</code> (as <code>.mar-search-list</code> does). A blur inside
          a blur samples what is already blurred: twice the cost and a muddy edge.
        </li>
        <li>
          <strong>No top highlight.</strong> No surface gets a lighter top edge: no
          <code>inset 0 1px 0</code> light, no brighter <code>border-top</code>, no sheen on a
          <code>::before</code>. A surface has an even hairline on all sides (Borders › Hairline) or
          none. Lines inside a surface, between rows or above a footer, are separators, not edges.
        </li>
        <li>
          <strong>Contrast</strong>: text on glass ≥ 4.5:1 (3:1 for icons and text from 18px),
          checked with pure white and pure black behind it. The frames above show each level's
          numbers; anything under 4.5 is red.
        </li>
        <li>
          <strong>Pablo's shell glass is painted, not blurred</strong>
          (<code>ui/surfaces.css</code>: gradients on the page and title bar). In the shipped app,
          Electron's macOS <code>vibrancy</code> and Windows <code>acrylic</code> do the window's
          glass.
        </li>
      </ul>

      <h2>Performance</h2>
      <ul>
        <li>
          A <code>backdrop-filter</code> redraws whenever what's behind it moves. Keep it on small
          layers that float (menus, chips, bars), never on large or scrolling areas: full-height
          panels over moving content, list rows, every card of a grid.
        </li>
        <li>
          Animate the glass's <code>opacity</code> and <code>transform</code> (the menus' entry
          does), never the blur radius.
        </li>
        <li>
          <code>will-change: transform</code> only on glass that animates, and only while it does.
          On static glass it holds a layer for nothing. Nothing in the code sets it today, which is
          right.
        </li>
        <li>
          Chromium (Electron) needs no <code>-webkit-backdrop-filter</code>. Add it only if these
          styles ever ship to Safari.
        </li>
      </ul>
    </template>
    <template v-else>
      <h2>Fallback: no blur, reduced transparency</h2>
      <p>
        The code has neither today: no <code>@supports not (backdrop-filter)</code> and no
        <code>prefers-reduced-transparency</code>. With the variables below, both are a few lines.
      </p>
      <pre class="ds-mat-code"><code>{{ FALLBACK }}</code></pre>

      <h2>The CSS today, per level</h2>
      <p>
        Pulled from the source files as they are now, with their line numbers. Copy from here, or
        better, from the proposal below once it exists.
      </p>
      <section v-for="l in LEVELS" :key="l.id" class="ds-mat-snips">
        <h3>{{ l.name }}</h3>
        <template v-for="(s, i) in snippets(l.id)" :key="i">
          <p v-if="'missing' in s" class="ds-mat-missing">{{ s.missing }}</p>
          <figure v-else>
            <figcaption>
              <code>{{ s.file }}:{{ s.line }}</code>
            </figcaption>
            <pre class="ds-mat-code"><code>{{ s.code }}</code></pre>
          </figure>
        </template>
      </section>

      <h2>Duplicated values</h2>
      <p>
        Every <code>backdrop-filter</code> (and Tailwind <code>backdrop-blur-*</code>) in the New UI
        proposal and Pablo's parts, grouped by value, parsed from the source now ({{
          inDefault.length
        }}
        uses; {{ elsewhere }} more in explorations behind other knobs: p20, graph, agent, explore,
        learn). The same value is typed in several files.
      </p>
      <div class="ds-mat-dups">
        <template v-for="g in repeated" :key="g.value">
          <code class="ds-mat-dup-v">{{ g.value }} × {{ g.uses.length }}</code>
          <span>
            <code v-for="u in g.uses" :key="`${u.file}:${u.line}`" :title="u.selector"
              >{{ u.file }}:{{ u.line }}</code
            >
          </span>
        </template>
      </div>

      <h2>Proposal: consolidate into variables</h2>
      <p>
        Not done in the app; this documents it. One file holds the scale and each level's tint,
        opacity, saturate, ring and shadow, dark and light, and each component uses its level. The
        values are today's, so nothing changes on screen except where a comment says it rounds.
      </p>
      <pre class="ds-mat-code"><code>{{ PROPOSAL }}</code></pre>
    </template>
  </article>
</template>

<style>
.ds-mat-doc {
  max-width: 980px;
}
.ds-mat-doc h3 {
  margin-top: 6px;
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 600;
}
.ds-mat-uses,
.ds-mat-dups {
  display: grid;
  grid-template-columns: minmax(150px, max-content) 1fr;
  gap: 8px 16px;
  font-size: 12.5px;
}
.ds-mat-uses code,
.ds-mat-dups code {
  color: var(--color-subtle-foreground);
  font-size: 11px;
}
.ds-mat-dups > span {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
}
.ds-mat-dup-v {
  color: var(--color-base-foreground) !important;
}
.ds-mat-snips {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ds-mat-snips figure {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ds-mat-snips figcaption code {
  color: var(--color-subtle-foreground);
  font-size: 11px;
}
.ds-mat-code {
  overflow-x: auto;
  padding: 12px 14px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 4%, var(--color-content-background));
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  color: var(--color-base-foreground);
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre;
}
.ds-mat-missing {
  color: var(--color-status-danger);
  font-size: 12px;
}
</style>
