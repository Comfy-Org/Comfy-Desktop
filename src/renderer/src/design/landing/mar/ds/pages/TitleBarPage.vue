<script setup lang="ts">
import DesktopTitleBar from '../../../parts/DesktopTitleBar.vue'
import type { TitleBarState } from '../../../titleBarBridge'
import portraitSun from '../../assets/portrait-sun.jpg'
import MarTitleTabs from '../../shell/MarTitleTabs.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import Stage from '../kit/Stage.vue'
import ShotsPage, { type Shot } from './ShotsPage.vue'

/** The tabs title bar (shell/MarTitleTabs.vue) in its states: the same
 *  published state the app's bar reads (titleBarBridge.ts). */
const base: TitleBarState = {
  milestone: 10,
  home: true,
  menuOpen: false,
  front: null,
  builds: [],
  options: [],
  runsOn: { name: 'My Local 1', kind: 'local' }
}
const WORKFLOWS = [
  { id: 'a', name: 'Portrait relight', build: 'My Local 1', kind: 'local' as const },
  { id: 'b', name: 'Untitled workflow', build: 'My Local 1', kind: 'local' as const },
  { id: 'c', name: 'Untitled workflow 2', build: 'Comfy Cloud', kind: 'cloud' as const }
]
const STATES: { label: string; state: TitleBarState; force?: string; target?: string }[] = [
  { label: 'Home · nothing open', state: base },
  {
    label: 'Home · workflows open, still in view',
    state: { ...base, tabs: WORKFLOWS, tabFront: null }
  },
  {
    label: 'a workflow in front',
    state: { ...base, home: false, tabs: WORKFLOWS, tabFront: 'b' }
  },
  {
    label: 'a workflow and an app',
    state: {
      ...base,
      home: false,
      tabs: WORKFLOWS.slice(0, 1),
      tabFront: null,
      apps: [{ id: 'cs', name: 'Cinematic Studio', thumb: portraitSun }],
      appFront: 'cs'
    }
  },
  {
    label: 'build pill · hover',
    state: { ...base, tabs: WORKFLOWS.slice(0, 1) },
    force: 'hover',
    target: 'button[aria-haspopup="menu"]'
  },
  {
    label: 'a tab · hover (its close shows)',
    state: { ...base, home: false, tabs: WORKFLOWS, tabFront: 'a' },
    force: 'hover',
    target: 'nav > div:nth-of-type(2)'
  }
]

const BREADCRUMB: Shot[] = [
  {
    label: 'Prototype menu › Title bar › Breadcrumb',
    seed: { 'comfy.design.mar.titleBar.v2': 'breadcrumb' },
    crop: [0, 0, 1280, 120]
  }
]
const CLOUD: Shot[] = [
  {
    label: 'Comfy Cloud · no build switcher',
    seed: { 'comfy.design.mar.surface': 'cloud' },
    crop: [0, 0, 1280, 120]
  }
]
</script>

<template>
  <Section
    title="Title bar"
    note="Tabs by default: Home as an icon, then the build it runs on (a filled pill), a short divider, then one tab per open workflow and app, so an open workflow stays in view on Home. The divider is the bar's one line. Then the icons and the app menu."
  >
    <Cells :min="560">
      <Cell label="as the app has it" on="bare" fill><DesktopTitleBar /></Cell>
    </Cells>
  </Section>
  <Section
    title="Tabs"
    note="A tab is named after its workflow, never its build: the pill says where it runs. A new one is Untitled workflow, numbered from the second (Untitled workflow 2). Picking a build in the pill switches it; it never opens a tab."
  >
    <Cells :min="560">
      <Cell
        v-for="s in STATES"
        :key="s.label"
        :label="s.label"
        on="bare"
        fill
        :force="s.force"
        :target="s.target"
      >
        <div class="ds-tb"><MarTitleTabs :state="s.state" /></div>
      </Cell>
    </Cells>
  </Section>
  <Section title="Build switch" note="Opens from the build pill, under it.">
    <Cells :min="560"><Stage id="build-switch" label="open" /></Cells>
  </Section>
  <ShotsPage
    title="Breadcrumb"
    note="Pablo's breadcrumb, one pick away in the Prototype menu."
    :shots="BREADCRUMB"
  />
  <ShotsPage
    title="On Comfy Cloud"
    note="There is no build to switch to on Comfy Cloud, so the title bar shows no switcher."
    :shots="CLOUD"
  />
</template>

<style>
/* The bar's own fill and height, for a tab row on its own. */
.ds-tb {
  display: flex;
  width: 100%;
  height: 44px;
  align-items: center;
  padding: 0 14px;
  background: var(--color-titlebar-background);
}
</style>
