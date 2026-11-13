<script setup lang="ts">
import { Video } from 'lucide-vue-next'
import foxSnow from '../../assets/fox-snow.jpg'
// The media badge is styled by the Assets page.
import '../../pages/MarAssetsPage.vue'
import AppShot from '../kit/AppShot.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import { useMode } from '../kit/mode'

/**
 * Surfaces (UI-RULES › Surfaces): what separates things is space and a
 * fill, never a line. Overview: each rule where the prototype has it.
 * Details: the values.
 */
const overview = useMode().mode === 'overview'
const PANEL =
  'color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-content-background))'
const VALUES: [string, string][] = [
  ['Panel beside content', `${PANEL}, radius 14px, no stroke, no shadow`],
  ['Text block in a panel', 'the foreground at 5%, radius 10px, padding 10px 12px'],
  ['Sidebar inset', '8px from the edges, the full height of its area'],
  ['Glass over pictures', 'rgb(14 14 16 / 0.28), blur(14px) saturate(1.5)'],
  ['Controls on a stage', 'the menu glass (menus/layers.css)'],
  [
    'Lines allowed',
    'the hairline over a red menu line, and the short divider after the title bar’s build pill'
  ]
]
</script>

<template>
  <template v-if="overview">
    <Section
      title="Panels a step lighter"
      note="A panel beside content (a sidebar, the asset view's details) is a fill a step lighter than what's behind it, radius 14px, no stroke, no shadow. No lines: space and a fill separate things."
    >
      <Cells :min="420">
        <AppShot
          label="the asset view's details (.mad-side)"
          page="assets"
          run="asset"
          :crop="[820, 20, 460, 760]"
        />
      </Cells>
      <Cells :min="420">
        <Cell label="the fill, on the page" fill>
          <div class="ds-sf-page">
            <div class="ds-sf-panel" :style="{ background: PANEL }">
              <p class="ds-sf-label">Asset details</p>
              <p class="ds-sf-kv"><span>Type</span><span>Image · PNG</span></p>
              <p class="ds-sf-kv"><span>Size</span><span>1.9 MB</span></p>
            </div>
          </div>
        </Cell>
      </Cells>
    </Section>
    <Section
      title="Sidebars float"
      note="Inset 8px from the edges, the full height of their area, never flush to the window: Home's sidebar, the Assets tab's in ComfyUI (graph/MarGraph.vue .mg-assets-nav)."
    >
      <Cells :min="420">
        <AppShot label="Home's sidebar" page="overview" :crop="[0, 36, 400, 764]" />
        <AppShot label="beside a library page" page="assets" :crop="[0, 36, 640, 380]" />
      </Cells>
    </Section>
    <Section
      title="Text blocks go in a box"
      note="Free text (a prompt, a description, a note) sits in a surface with padding and radius, never loose on a panel."
    >
      <Cells :min="420">
        <AppShot
          label="a workflow's description"
          page="overview"
          run="template"
          :crop="[840, 24, 420, 320]"
        />
      </Cells>
    </Section>
    <Section
      title="Glass only over pictures"
      note="Badges, chips and scrims over imagery use the light dark glass; nothing on the plain page is glass. Controls on a stage (Result / Graph, zoom) take the menu glass, the same as the menu they open."
    >
      <Cells :min="260">
        <Cell label="a badge on a picture" fill>
          <div class="ds-sf-pic" :style="{ backgroundImage: `url(${foxSnow})` }">
            <span class="mar-asset-len"><Video :size="12" />0:07</span>
          </div>
        </Cell>
        <AppShot
          label="controls on the stage"
          page="overview"
          run="template"
          :crop="[40, 20, 780, 760]"
        />
      </Cells>
    </Section>
  </template>
  <Section
    v-else
    title="Values"
    note="Read from the prototype's CSS; UI-RULES.md › Surfaces says why."
  >
    <dl class="ds-sf-values">
      <div v-for="[k, v] in VALUES" :key="k">
        <dt>{{ k }}</dt>
        <dd>{{ v }}</dd>
      </div>
    </dl>
  </Section>
</template>

<style>
.ds-sf-page {
  display: flex;
  width: 100%;
  padding: 24px;
  border-radius: 12px;
  background: var(--color-content-background);
}
.ds-sf-panel {
  display: flex;
  width: 260px;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: 14px;
  font-size: 13px;
}
.ds-sf-label {
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.ds-sf-kv {
  display: flex;
  justify-content: space-between;
  color: var(--color-muted-foreground);
}
.ds-sf-kv span:last-child {
  color: var(--color-base-foreground);
}
.ds-sf-pic {
  position: relative;
  width: 100%;
  height: 170px;
  overflow: hidden;
  border-radius: 12px;
  background-position: center;
  background-size: cover;
}
.ds-sf-values {
  display: grid;
  gap: 14px;
  max-width: 760px;
  font-size: 13px;
}
.ds-sf-values div {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 16px;
}
.ds-sf-values dt {
  color: var(--color-muted-foreground);
}
.ds-sf-values dd {
  margin: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
}
</style>
