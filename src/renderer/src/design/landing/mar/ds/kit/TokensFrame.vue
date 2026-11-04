<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { TooltipProvider } from 'reka-ui'
import { Code, Palette, Play, Plus } from 'lucide-vue-next'
import { AgentChat } from '../../icons/agentChat'
import MarModeSwitch from '../../modes/MarModeSwitch.vue'
import MarSeg from '../../pages/MarSeg.vue'
import MarStatus, { type ItemStatus } from '../../pages/MarStatus.vue'
import ModeNav from '../../../parts/env/ModeNav.vue'
import SidebarGroup from '../../../parts/env/SidebarGroup.vue'
import Button from '../../../ui/Button.vue'
import Input from '../../../ui/Input.vue'
import SectionHeader from '../../../ui/SectionHeader.vue'
import Select from '../../../ui/Select.vue'
import StatusDot from '../../../ui/StatusDot.vue'
import WorkflowCard from '../../WorkflowCard.vue'
import portraitSun from '../../assets/portrait-sun.jpg'
import lakeFog from '../../assets/lake-fog.jpg'
import { thumb } from '../../../mock'
import { NODE_COLORS, nodeColor } from '../theme/model'
import { cssOf } from '../theme/color'
import Cell from './Cell.vue'
import Cells from './Cells.vue'
import Section from './Section.vue'
import Stage from './Stage.vue'

/**
 * The Theme playground's specimens in one theme (pages/ThemePlayground.vue
 * draws one frame per theme). The prototype's own components read the
 * names it uses today, which the playground maps onto its tokens
 * (theme/model.ts frameCss); the canvas and the frontend rules read the
 * tokens (--pg-*) directly. Stages inside carry `?pg` too.
 */
const theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark'

const MODES = [
  { value: 'create', label: 'Create', icon: Palette },
  { value: 'build', label: 'Build', icon: Code },
  { value: 'agent', label: 'Agent', icon: AgentChat }
]
const mode = ref('create')
const tab = ref('all')
const TABS = [
  { value: 'all', label: 'All', count: 24 },
  { value: 'mine', label: 'Mine' },
  { value: 'shared', label: 'Shared' }
]
const field = ref('hero-shot-v4')
const sort = ref('recent')
const SORTS = [
  { value: 'recent', label: 'Newest first' },
  { value: 'name', label: 'Name' }
]
const STATUSES: ItemStatus[] = ['executing', 'queued', 'completed', 'failed', 'live', 'update']

const COLORED = NODE_COLORS.map((n) => ({
  id: n.id,
  label: n.id.replace('_', ' '),
  head: cssOf(nodeColor(n.color, theme)),
  body: cssOf(nodeColor(n.bgcolor, theme))
}))

const root = ref<HTMLElement>()
onMounted(() => {
  const el = root.value!
  new ResizeObserver(() =>
    parent.postMessage({ type: 'mar-ds:height', h: Math.ceil(el.offsetHeight) }, '*')
  ).observe(el)
})
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div ref="root" class="proto-ui ds-frame-page pgf">
      <Section
        title="ComfyUI canvas"
        note="Canvas and grid, a node, the selected one (outline in foreground), one bypassed, then every custom node colour (light lightens them by 0.5, as the frontend does)."
      >
        <div class="pgf-canvas">
          <div class="pgf-nodes">
            <article class="pgf-node">
              <header>Load Checkpoint</header>
              <div class="pgf-body">
                <p class="pgf-out">MODEL <i style="--slot: #b39ddb" /></p>
                <p class="pgf-out">CLIP <i style="--slot: #ffd500" /></p>
                <div class="pgf-widget"><span>ckpt_name</span><b>flux2-dev.safetensors</b></div>
              </div>
            </article>
            <article class="pgf-node is-selected">
              <header>KSampler</header>
              <div class="pgf-body">
                <p class="pgf-in"><i style="--slot: #b39ddb" /> model</p>
                <div class="pgf-widget"><span>seed</span><b>482301</b></div>
                <div class="pgf-widget"><span>steps</span><b>20</b></div>
                <div class="pgf-widget"><span>cfg</span><b>3.5</b></div>
              </div>
            </article>
            <article class="pgf-node is-bypassed">
              <header>VAE Decode</header>
              <div class="pgf-body">
                <p class="pgf-in"><i style="--slot: #ff9cf9" /> samples</p>
                <div class="pgf-widget"><span>tile</span><b>512</b></div>
              </div>
            </article>
          </div>
          <div class="pgf-colors">
            <article
              v-for="n in COLORED"
              :key="n.id"
              class="pgf-node is-mini"
              :style="{ '--h': n.head, '--b': n.body }"
            >
              <header>{{ n.label }}</header>
              <div class="pgf-body">
                <div class="pgf-widget"><span>steps</span><b>20</b></div>
              </div>
            </article>
          </div>
        </div>
      </Section>

      <Section
        title="Shell"
        note="The prototype's sidebar, tabs, menu, buttons and fields, on the names they use today (see Legacy names). Then the frontend's rules: rows with no fill, hover accent/40, selected accent/60."
      >
        <Cells :min="240">
          <Cell label="sidebar" on="sidebar" class="ds-sidebar">
            <div class="flex w-55 flex-col">
              <div class="mb-3 flex h-8.5 items-center">
                <MarModeSwitch v-model="mode" :options="MODES" />
              </div>
              <ModeNav mode="create" />
              <SidebarGroup />
            </div>
          </Cell>
          <div class="pgf-stack">
            <Cell label="tabs" fill>
              <MarSeg v-model="tab" :options="TABS" label="Filter" />
            </Cell>
            <Cell label="buttons" fill>
              <div class="flex flex-wrap gap-2">
                <Button variant="primary"><Play :size="14" />Run</Button>
                <Button variant="secondary">Share</Button>
                <Button variant="subtle"><Plus :size="14" />New</Button>
                <Button variant="ghost">Cancel</Button>
                <Button variant="destructive">Delete</Button>
              </div>
            </Cell>
            <Cell label="fields" fill>
              <div class="flex flex-col gap-2">
                <Input v-model="field" />
                <Select v-model="sort" :options="SORTS" label="Sort" />
              </div>
            </Cell>
          </div>
        </Cells>
        <Cells :min="420">
          <Stage id="create-menu-hover" label="menu, a row highlighted" />
        </Cells>
        <Cells :min="420">
          <Cell
            label="frontend rules on background, card and popover; primary and input"
            on="bare"
            fill
          >
            <div class="pgf-rules">
              <div
                v-for="s in ['background', 'card', 'popover']"
                :key="s"
                class="pgf-surface"
                :style="{ background: `var(--pg-${s})` }"
              >
                <span class="pgf-surface-name">{{ s }}</span>
                <p class="pgf-row">Idle</p>
                <p class="pgf-row is-hover">Hover</p>
                <p class="pgf-row is-selected">Selected</p>
              </div>
              <div class="pgf-surface" style="background: var(--pg-background)">
                <span class="pgf-surface-name">primary, input</span>
                <button type="button" class="pgf-primary">Queue</button>
                <span class="pgf-input">Search…</span>
              </div>
            </div>
          </Cell>
        </Cells>
      </Section>

      <Section
        title="Desktop · Home"
        note="Recently used, the Run on picker open, the status chips and dots."
      >
        <Cells :min="420">
          <Cell label="card row" fill>
            <div>
              <SectionHeader title="Recently used" link="See all" />
              <div class="pgf-cards">
                <WorkflowCard
                  :src="portraitSun"
                  title="hero-shot-v4"
                  meta="My Local 1"
                  right="2h"
                />
                <WorkflowCard
                  :src="lakeFog"
                  title="lake-fog-upscale"
                  meta="Comfy Cloud"
                  right="1d"
                />
                <WorkflowCard
                  :src="thumb('image_flux2')"
                  title="flux2-product"
                  meta="My Local 1"
                  right="3d"
                />
              </div>
            </div>
          </Cell>
        </Cells>
        <Cells :min="420">
          <Stage id="run-on-menu" label="Run on, open" />
        </Cells>
        <Cells :min="420">
          <Cell label="status chips and dots" fill>
            <div class="flex flex-wrap items-center gap-2">
              <MarStatus v-for="s in STATUSES" :key="s" :status="s" />
              <span class="ml-2 inline-flex items-center gap-1.5 text-ui text-muted-foreground"
                ><StatusDot status="running" />Running</span
              >
              <span class="inline-flex items-center gap-1.5 text-ui text-muted-foreground"
                ><StatusDot />Idle</span
              >
            </div>
          </Cell>
        </Cells>
      </Section>
    </div>
  </TooltipProvider>
</template>

<style>
.pgf .ds-section-note {
  max-width: none;
}
.pgf-stack {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
}
.pgf-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 8px;
}

/* The canvas: the fill and a lines-only grid (#22900), steady at any zoom. */
.pgf-canvas {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
  border-radius: 12px;
  background-color: var(--pg-canvas);
  background-image:
    linear-gradient(var(--pg-canvas-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--pg-canvas-grid) 1px, transparent 1px);
  background-size: 20px 20px;
  background-position: -1px -1px;
}
.pgf-nodes,
.pgf-colors {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px;
}
.pgf-colors {
  gap: 10px;
}
.pgf-node {
  position: relative;
  width: 180px;
  overflow: hidden;
  border: 1px solid var(--pg-node-border);
  border-radius: 12px;
  color: var(--pg-node-foreground);
  font-size: 12px;
  line-height: 16px;
}
.pgf-node > header {
  padding: 6px 10px;
  background: var(--h, var(--pg-node-header));
  font-weight: 500;
}
.pgf-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px 10px;
  background: var(--b, var(--pg-node));
}
.pgf-node.is-selected {
  outline: 2px solid var(--pg-foreground);
  outline-offset: 1px;
  overflow: visible;
}
.pgf-node.is-selected > header {
  border-radius: 11px 11px 0 0;
}
.pgf-node.is-selected > .pgf-body {
  border-radius: 0 0 11px 11px;
}
.pgf-node.is-bypassed::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  background: color-mix(in oklab, var(--pg-bypass) 60%, transparent);
  pointer-events: none;
}
.pgf-node.is-mini {
  width: 112px;
}
.pgf-in,
.pgf-out {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pgf-out {
  justify-content: flex-end;
}
.pgf-in i,
.pgf-out i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--slot);
}
.pgf-widget {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--pg-node-widget);
}
.pgf-widget b {
  overflow: hidden;
  color: var(--pg-foreground);
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The frontend's own rules, on its tokens. */
.pgf-rules {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.pgf-surface {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border: 1px solid var(--pg-border);
  border-radius: 12px;
  color: var(--pg-foreground);
  font-size: 13px;
}
.pgf-surface-name {
  padding: 0 8px 4px;
  color: var(--pg-muted-foreground);
  font-size: 11.5px;
}
.pgf-row {
  padding: 5px 8px;
  border-radius: 8px;
}
.pgf-row.is-hover {
  background: var(--pg-hover);
}
.pgf-row.is-selected {
  background: var(--pg-selected);
}
/* Past the prototype's reset of button fills (.proto-ui ×3). */
.pgf.pgf.pgf .pgf-primary {
  height: 30px;
  margin: 2px 0 6px;
  border-radius: 8px;
  background: var(--pg-primary);
  color: var(--pg-primary-foreground);
  font-weight: 500;
}
.pgf-input {
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--pg-border);
  border-radius: 8px;
  background: var(--pg-input);
  color: var(--pg-muted-foreground);
}
</style>
