<script setup lang="ts">
// Wherever this page is served from (the dev server's port can change).
const url = `${location.origin}${location.pathname}`
</script>

<template>
  <article class="ds-doc">
    <h1>Comfy Desktop · Design system</h1>
    <p>
      Every component in the New UI proposal for Comfy Desktop, in its states, dark by default
      (light or both from the header). It renders the prototype's real components, so it can't
      drift. Components show when to use them and their rules; Do / Don't, Specs and Playground
      where they apply.
    </p>

    <h2>How it's organised</h2>
    <ul>
      <li><strong>Foundations</strong>: colour, type, radius, materials, motion, interactions.</li>
      <li>
        <strong>Components</strong>: one large example, when to use it, Do / Don't, its rules; then
        States, Specs and Code.
      </li>
      <li>
        <strong>Patterns</strong>: components put together: filters bar, empty states, page header,
        cards grid, menus with summary, the library pages and flows.
      </li>
      <li><strong>Playground</strong>: any component with any props; copy its usage.</li>
    </ul>
    <p>
      The default view: Proposal › New UI, every UI Playground knob at its default. Dark by default;
      Light or Both from the header.
    </p>

    <details class="ds-fold">
      <summary>Where things come from</summary>
      <ul>
        <li>
          <strong>Token names</strong>: ComfyUI_frontend's design system, through Pablo's prototype
          (<code>landing/ui/tokens.css</code>, light values in <code>ui/looks/light.css</code>).
        </li>
        <li>
          <strong>Base kit</strong>: Pablo's components in <code>landing/ui/</code> (Button, menus,
          Tooltip, Select, SectionHeader, MediaCard…) and his parts in <code>landing/parts/</code>.
        </li>
        <li>
          <strong>The New UI pieces</strong>: <code>landing/mar/</code>. The New UI look over all of
          it is <code>mar/shell/marShell.css</code>, scoped to <code>[data-mar-ui='on']</code>;
          light is <code>[data-ds-theme='light']</code>. Production icons are in
          <code>mar/icons/</code>.
        </li>
      </ul>
      <p>Each page names its source files and when to use the component.</p>
    </details>

    <details class="ds-fold">
      <summary>All conventions</summary>
      <p>
        The shared conventions are in Notion, “Desktop UI: visual decisions”. These are the ones
        this page shows.
      </p>

      <h3>Colour</h3>
      <ul>
        <li>
          Grey scale UI: pictures and outputs carry the colour. Colour means status or progress.
        </li>
        <li>One primary (inverted) button per surface. Credits keep their production gold.</li>
      </ul>

      <h3>Glass</h3>
      <ul>
        <li>
          <strong>Blur only on what floats over content</strong> (menus, tooltips, the palette,
          modals and their scrim, chips on pictures). No blur inside blur. Levels, values and CSS:
          Foundations › Materials · Blur.
        </li>
        <li>Chips on pictures: grey at 60% over a blur, 11px.</li>
        <li>Text on glass passes contrast against the busiest picture behind it.</li>
      </ul>

      <h3>Menus and tooltips</h3>
      <ul>
        <li>
          <strong>One family</strong>: smoked glass a step lighter than the page, radius 14 around 6
          of padding so items nest at 8, quiet labels, inset hairlines; each grows from its trigger.
        </li>
        <li>
          <strong>Layered</strong>: a summary (workspace, credits) on a raised panel at the top; the
          current pick raised. The Run on picker groups builds by where they run.
        </li>
        <li><strong>A menu with one option is a button</strong> (or plain text).</li>
        <li>Tooltips are small glass labels with 8px corners.</li>
      </ul>

      <h3>Surfaces and cards</h3>
      <ul>
        <li>
          <strong>Cards never grow on hover</strong>: no lift, move or zoom. Hover lightens the
          surface and shows the star and ⋯. No borders, no lit top edge.
        </li>
        <li><strong>Nested corners run parallel</strong>: inner = outer − padding.</li>
        <li>
          <strong>One corner for controls</strong>: tabs, filters, sort, search and view share
          <code>--mar-tab-radius</code> (track) and <code>--mar-tab-item-radius</code> (item), from
          UI Playground › Corners (Soft 10 / 7 by default, Default 6 / 3). No fully rounded controls
          in filter bars; buttons keep --radius-control.
        </li>
        <li>
          Row cards (Home's builds, Where should Comfy run): one card, 72 tall, 16px corners, a 40px
          icon tile. Build cards on the Builds page: outputs, then specs on an 8px rhythm.
        </li>
        <li>
          <strong>State chips sit top-left</strong> on a card and move right when the select check
          shows. In a list the check sits over the thumbnail. With no picture yet, a card shows the
          canvas's dot grid.
        </li>
        <li>Progress for an item in flight is the bottom edge of its cover.</li>
      </ul>

      <h3>Layout</h3>
      <ul>
        <li>
          A page's toolbar: tabs on the left, with an indicator that slides to the pick (counts
          hidden); filters, Sort (an icon), search and view on the right.
        </li>
        <li>
          <strong>Page header</strong> (project, space): cover, title, state and one meta line on
          the left; one action group on the right: a single primary, then secondary, ⋯ last.
        </li>
        <li>Activity: milestones on a vertical line, time · dot · who did what.</li>
        <li>
          <strong>One empty state everywhere</strong> (<code>MarEmpty</code>): three pictures, the
          place's icon, one line, the one action that fills it. No results and errors use it too.
        </li>
        <li>
          Every library page has four states: Live, Loading (skeletons in the content's shape),
          Empty and Error (Try again). The shell never changes.
        </li>
      </ul>

      <h3>Navigation</h3>
      <ul>
        <li>
          Sidebar items 13px in rows of 32, 15px icons. Credits and the workspace at the foot.
        </li>
        <li>
          Empty sidebar groups don't show. Favorites appears once something is starred (up to four).
          Each group has a single way to add.
        </li>
        <li>
          <strong>Global search</strong> opens with <code>⌘K</code> anywhere and from the sidebar's
          first row. (Notion still says “no global search for now”.)
        </li>
        <li>The graph editor goes back Home from the Comfy logo heading its rail.</li>
      </ul>

      <h3>Fidelity to the product</h3>
      <ul>
        <li>
          <strong>Production icons</strong> where the product has the concept: the Comfy workflow
          graph, panels-top-left for an App, coins in credit gold, the Agent's chat with a corner
          sparkle. Lucide for the rest.
        </li>
        <li>
          <strong>Run states follow production</strong>: Running spins, Completed is a check, Failed
          an octagon, Draft a hollow dot. No percentages on items.
        </li>
        <li>Graph nodes follow ComfyUI's Vue node anatomy.</li>
        <li>Credits flyout: Alex's 13 states, as designed (the Row; no style picker).</li>
      </ul>

      <h3>Themes</h3>
      <ul>
        <li>Light and dark only; every pair is tuned in both.</li>
      </ul>
    </details>

    <h2>How to open it</h2>
    <p>
      With the prototype's dev server running (<code>pnpm dev</code>), open
      <a :href="url">{{ url }}</a
      >. Dark by default; the header switches to light or both. Pages are links
      (<code>#/sidebar</code>).
    </p>
    <p>
      It keeps the prototype's settings in memory, so it always shows the defaults and never changes
      what an open prototype tab shows.
    </p>

    <details class="ds-fold">
      <summary>How it is built</summary>
      <ul>
        <li>
          Each theme is a frame of the same page, since the themes live on
          <code>&lt;html&gt;</code>.
        </li>
        <li>
          Hover, focus and pressed are forced by copying every rule that uses
          <code>:hover</code>, <code>:focus-visible</code> or <code>:active</code> into one that
          also answers to <code>data-ds-force</code> (<code>kit/force.ts</code>).
        </li>
        <li>
          Open menus and tooltips each get a small frame of their own (<code>stages.ts</code>).
        </li>
        <li>
          Whole pages, modals and knob values are live frames of the app
          (<code>kit/AppShot.vue</code>), started on a page, Page state or setting.
        </li>
        <li>
          To add a component: a page in <code>pages/</code>, listed in <code>registry.ts</code>.
        </li>
      </ul>
    </details>
  </article>
</template>
