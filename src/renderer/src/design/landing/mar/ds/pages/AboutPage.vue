<script setup lang="ts">
// Wherever this page is served from (the dev server's port can change).
const url = `${location.origin}${location.pathname}`
</script>

<template>
  <article class="ds-doc">
    <h1>Mar's design system</h1>
    <p>
      Every component in Mar's proposal for Comfy Desktop, in every state, dark and light side by
      side. It renders the prototype's real components with their real styles, so it can't drift:
      when a component changes in the prototype, it changes here.
    </p>

    <h2>What it covers</h2>
    <p>
      The default view: Proposal Mar, every UI Playground knob at its default. Knobs that are part
      of the proposal's states are shown as variations next to it: Page state (Live, Loading, Empty,
      Error), User (First-time, Returning), Credits state, Corners and Look. Explorations behind
      other knobs are not here.
    </p>
    <ul>
      <li>
        <strong>Put together</strong>: the whole app, Home's spotlight, the five looks, users.
      </li>
      <li><strong>Shell, Home, Controls</strong>: components on their own, each state forced.</li>
      <li>
        <strong>Library pages</strong>: each page in its four Page states, live frames of the app.
      </li>
      <li><strong>Flows</strong>: the template modal, Build's Get started and Models, Deploy.</li>
    </ul>

    <h2>Where things come from</h2>
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
        <strong>Mar's pieces</strong>: <code>landing/mar/</code>. Her look over all of it is
        <code>mar/shell/marShell.css</code>, scoped to <code>[data-mar-ui='on']</code>; light is
        <code>[data-ds-theme='light']</code>. Production icons are in <code>mar/icons/</code>.
      </li>
    </ul>
    <p>Each page names its source files and when to use the component.</p>

    <h2>Rules</h2>
    <ul>
      <li>
        <strong>Hover never makes a card bigger.</strong> No lift, no scale, no zoom on the card or
        its picture. A card answers to hover with its surface only, one step lighter.
      </li>
      <li>
        <strong>Menus, popovers and selects are one family</strong>: a hairline edge (7%, 8% in
        light), radius 14 around 6 of padding so items nest at 8, quiet 11.5px labels, inset
        separators, and an entry that grows from the trigger.
      </li>
      <li>
        <strong>Menus are layered</strong>: more blur behind them, a summary (workspace, credits) on
        a raised panel at the top, and the current pick raised.
      </li>
      <li>Tooltips are small dark glass labels, like the menus, with 8px corners.</li>
      <li>The prompt box has a very faint edge: foreground 7%, 12% while typing.</li>
      <li>
        <strong>Nested corners run parallel</strong>: inner = outer − padding. The mode switch is 10
        around 3, so its segment is 7.
      </li>
      <li>
        <strong>Tabs, filters, sort, search and view share one corner</strong>:
        <code>--mar-tab-radius</code> on the track, <code>--mar-tab-item-radius</code> on what sits
        in it. They follow UI Playground › Corners: Soft 10 / 7 (default), Default 6 / 3.
      </li>
      <li>
        A page's toolbar: tabs on the left, with a pill that slides to the pick (counts hidden for
        now); filters, Sort (an icon), search and view on the right.
      </li>
      <li>
        <strong>Global search</strong> opens with <code>⌘K</code> anywhere and from the sidebar's
        first row: templates, workflows, projects and spaces in one palette.
      </li>
      <li>
        <strong>Status chips follow production</strong>: Running spins, Completed is a check, Failed
        an octagon. No percentages. On cards they sit top-left, and shift right when the select
        check shows.
      </li>
      <li>
        <strong>Production icons where the product has the concept</strong>: the Comfy workflow
        graph, panels-top-left for an App, the Agent's chat with a corner sparkle. Lucide for the
        rest.
      </li>
      <li>
        Every library page has four states: Live, Loading (skeletons in the content's shape), Empty
        (the one action that fills it) and Error (Retry). The shell never changes.
      </li>
      <li>One primary (white) button per surface.</li>
      <li>Colour is for status only; surfaces are the foreground at low opacity.</li>
    </ul>

    <h2>How to open it</h2>
    <p>
      With the prototype's dev server running (<code>pnpm dev</code>), open
      <a :href="url">{{ url }}</a
      >. The header switches between dark and light side by side, or one of them. Pages are links
      (<code>#/sidebar</code>).
    </p>
    <p>
      It keeps the prototype's settings in memory, so it always shows the defaults and never changes
      what an open prototype tab shows.
    </p>

    <h2>How it is built</h2>
    <ul>
      <li>
        Each theme is a frame of the same page, since the themes live on <code>&lt;html&gt;</code>.
      </li>
      <li>
        Hover, focus and pressed are forced by copying every rule that uses
        <code>:hover</code>, <code>:focus-visible</code> or <code>:active</code> into one that also
        answers to <code>data-ds-force</code> (<code>kit/force.ts</code>).
      </li>
      <li>Open menus and tooltips each get a small frame of their own (<code>stages.ts</code>).</li>
      <li>
        Whole pages, modals and knob values are live frames of the app
        (<code>kit/AppShot.vue</code>), started on a page, Page state or setting.
      </li>
      <li>
        To add a component: a page in <code>pages/</code>, listed in <code>registry.ts</code>.
      </li>
    </ul>
  </article>
</template>
