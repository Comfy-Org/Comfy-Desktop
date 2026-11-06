<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { ArrowLeft, PanelRightClose, PanelRightOpen, RotateCcw } from 'lucide-vue-next'
import Button from '../../../ui/Button.vue'
import Select from '../../../ui/Select.vue'
import Switch from '../../../ui/Switch.vue'
import MarSeg from '../../pages/MarSeg.vue'
import { useCloud } from '../theme/cloudBridge'
import { ALEX, HOME, MAIN, type Mode } from '../theme/model'
import { changes, compare, editing, reset } from '../theme/usePlayground'
import CloudPanel from './CloudPanel.vue'
import StudioContrast from './StudioContrast.vue'
import StudioExport from './StudioExport.vue'
import StudioIntegrate from './StudioIntegrate.vue'
import StudioLegacy from './StudioLegacy.vue'
import StudioPrimitives from './StudioPrimitives.vue'
import StudioTokens from './StudioTokens.vue'
import SurfaceFrame from './SurfaceFrame.vue'

/**
 * The Theme playground, full screen: a live surface fills the page and
 * the editor docks beside it. New Home is the prototype's own (the CSS
 * theme/apply.ts writes); ComfyUI is production, on Comfy Cloud in its own
 * tab, fed the tokens by message (theme/cloudBridge.ts). What changes is
 * the real product, not a copy of it.
 */
type Surface = 'home' | 'comfy'
type View = 'dark' | 'light' | 'split'
type Screen = 'none' | 'mac' | 'windows' | 'glare'
type Tab = 'tokens' | 'primitives' | 'contrast' | 'legacy' | 'integrate' | 'export'

const SURFACES: { value: Surface; label: string }[] = [
  { value: 'home', label: 'New Home' },
  { value: 'comfy', label: 'ComfyUI (Cloud)' }
]
const VIEWS: { value: View; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'split', label: 'Split' }
]
const SCREENS: { value: Screen; label: string; hint: string }[] = [
  { value: 'none', label: 'Screen as is', hint: 'As the values are' },
  { value: 'mac', label: 'Mac', hint: 'Bright, high contrast' },
  { value: 'windows', label: 'Dim Windows laptop', hint: 'Gamma 1.5, 85%' },
  { value: 'glare', label: 'Glare', hint: 'Ambient light, blacks lift' }
]
const TABS: { value: Tab; label: string; is: Component }[] = [
  { value: 'tokens', label: 'Tokens', is: StudioTokens },
  { value: 'primitives', label: 'Primitives', is: StudioPrimitives },
  { value: 'contrast', label: 'Contrast', is: StudioContrast },
  { value: 'legacy', label: 'Legacy', is: StudioLegacy },
  { value: 'integrate', label: 'Integrate', is: StudioIntegrate },
  { value: 'export', label: 'Export', is: StudioExport }
]

// This page's own view: kept in this browser.
const VIEW_KEY = 'mar-ds.theme-studio.view'
const saved = ((): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}')
  } catch {
    return {}
  }
})()
const pick = <T extends string>(list: { value: T }[], v: string | undefined): T =>
  list.find((o) => o.value === v)?.value ?? list[0]!.value
const surface = ref(pick(SURFACES, saved.surface))
const view = ref(pick(VIEWS, saved.view))
const screen = ref(pick(SCREENS, saved.screen))
const tab = ref(pick(TABS, saved.tab))
const dock = ref(saved.dock !== 'closed')
watch(
  [surface, view, screen, tab, dock],
  () =>
    localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({
        surface: surface.value,
        view: view.value,
        screen: screen.value,
        tab: tab.value,
        dock: dock.value ? 'open' : 'closed'
      })
    ),
  { deep: true }
)

const modes = computed<Mode[]>(() => (view.value === 'split' ? ['dark', 'light'] : [view.value]))
// The panels lead with the theme on screen; the chrome follows it too.
watch(
  view,
  (v) => {
    editing.value = v === 'light' ? 'light' : 'dark'
    document.documentElement.dataset.dsTheme = editing.value
  },
  { immediate: true }
)

const cloud = useCloud(editing)
const src = (m: Mode): string => {
  const q = new URLSearchParams({
    frame: 'app',
    theme: m,
    proposal: 'mariana',
    page: 'overview',
    pg: '1'
  })
  return `?${q}`
}
// /playground is this page on the shared site; the DS is its root.
const dsHref = location.pathname.replace(/playground\/?$/, '')
</script>

<template>
  <div class="st proto-ui">
    <svg class="st-filters" aria-hidden="true">
      <filter id="pg-screen-mac">
        <feComponentTransfer>
          <feFuncR type="linear" slope="1.06" intercept="-0.02" />
          <feFuncG type="linear" slope="1.06" intercept="-0.02" />
          <feFuncB type="linear" slope="1.06" intercept="-0.02" />
        </feComponentTransfer>
        <feColorMatrix type="saturate" values="1.08" />
      </filter>
      <filter id="pg-screen-windows">
        <feComponentTransfer>
          <feFuncR type="gamma" amplitude="0.85" exponent="1.5" offset="0" />
          <feFuncG type="gamma" amplitude="0.85" exponent="1.5" offset="0" />
          <feFuncB type="gamma" amplitude="0.85" exponent="1.5" offset="0" />
        </feComponentTransfer>
        <feColorMatrix type="saturate" values="0.85" />
      </filter>
      <filter id="pg-screen-glare">
        <feComponentTransfer>
          <feFuncR type="linear" slope="0.72" intercept="0.2" />
          <feFuncG type="linear" slope="0.72" intercept="0.2" />
          <feFuncB type="linear" slope="0.72" intercept="0.2" />
        </feComponentTransfer>
        <feColorMatrix type="saturate" values="0.8" />
      </filter>
    </svg>

    <header class="st-bar">
      <a class="st-back" :href="dsHref" title="Back to the design system"
        ><ArrowLeft :size="15" /><span>Theme playground</span></a
      >
      <MarSeg v-model="surface" :options="SURFACES" label="Surface" />
      <MarSeg v-model="view" :options="VIEWS" label="Theme" />
      <Select v-model="screen" :options="SCREENS" size="sm" class="st-screen" />
      <span class="st-spacer" />
      <span class="st-count">{{ changes }} changes from main</span>
      <Button variant="ghost" size="sm" @click="dock = !dock">
        <component :is="dock ? PanelRightClose : PanelRightOpen" :size="15" />
        {{ dock ? 'Hide editor' : 'Edit tokens' }}
      </Button>
    </header>

    <div class="st-body">
      <main :class="['st-stage', `is-${screen}`]">
        <CloudPanel
          v-if="surface === 'comfy'"
          :status="cloud.status.value"
          :split="view === 'split'"
          @open="cloud.open"
          @stop="cloud.stop"
          @resume="cloud.resume"
        />
        <template v-else>
          <SurfaceFrame
            v-for="m in modes"
            :key="m"
            :src="src(m)"
            :title="`New Home, ${m}`"
            :style="{ filter: screen === 'none' ? undefined : `url(#pg-screen-${screen})` }"
          />
        </template>
      </main>

      <aside v-if="dock" class="st-dock" aria-label="Token editor">
        <div class="st-dock-head">
          <MarSeg v-model="tab" :options="TABS" label="Editor" />
          <div class="st-dock-row">
            <span>Start from</span>
            <Button variant="secondary" size="sm" @click="reset(HOME)"
              ><RotateCcw :size="13" />New Home</Button
            >
            <Button variant="ghost" size="sm" @click="reset(ALEX)"
              ><RotateCcw :size="13" />Alex’s stack</Button
            >
            <Button variant="ghost" size="sm" @click="reset(MAIN)"
              ><RotateCcw :size="13" />main</Button
            >
            <label class="st-toggle"><Switch v-model="compare" />Show main</label>
          </div>
        </div>
        <div class="st-dock-body">
          <component :is="TABS.find((t) => t.value === tab)!.is" />
        </div>
      </aside>
    </div>
  </div>
</template>

<style>
html:has(.st),
html:has(.st) body {
  height: 100%;
  overflow: hidden;
}
.st {
  display: flex;
  height: 100vh;
  flex-direction: column;
  background: var(--color-app-background);
  color: var(--color-base-foreground);
  font-size: 13px;
}
.st-filters {
  position: absolute;
  width: 0;
  height: 0;
}
.st code {
  font-family: var(--ds-mono);
  font-size: 12px;
}
.st small {
  display: block;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}

/* Toolbar */
.st-bar {
  display: flex;
  min-height: 48px;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-default);
}
.st-back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-right: 6px;
  padding: 4px 8px 4px 4px;
  border-radius: 8px;
  color: var(--color-base-foreground);
  font-weight: 600;
  text-decoration: none;
}
.st-back:hover {
  background: var(--color-secondary-background-hover);
}
.st.st.st .st-screen {
  width: 190px;
}
.st-spacer {
  flex: 1;
}
.st-count {
  color: var(--color-muted-foreground);
  font-variant-numeric: tabular-nums;
}

/* Surfaces */
.st-body {
  display: flex;
  min-height: 0;
  flex: 1;
}
.st-stage {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  gap: 1px;
  background: var(--color-border-default);
}
.st-stage.is-glare::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    120% 60% at 75% 8%,
    rgb(255 255 255 / 0.22),
    rgb(255 255 255 / 0.06) 45%,
    transparent 70%
  );
  pointer-events: none;
}

/* Dock */
.st-dock {
  display: flex;
  width: 480px;
  flex-shrink: 0;
  flex-direction: column;
  border-left: 1px solid var(--color-border-default);
  background: var(--color-app-background);
}
.st-dock-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-default);
}
.st-dock-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  color: var(--color-muted-foreground);
}
.st-dock-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 16px 16px 40px;
}
.st-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.st-sec {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.st-note {
  margin: 0;
  color: var(--color-muted-foreground);
  line-height: 20px;
}
.st-group {
  margin: 14px 0 0;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.st-group small {
  display: inline;
  margin-left: 6px;
  letter-spacing: 0;
  text-transform: none;
}

/* Shared controls (past the prototype's reset, .proto-ui ×3) */
.st.st.st .pg-pick {
  width: auto;
  min-width: 0;
  flex: 1;
}
.st.st.st .pg-hex {
  width: 96px;
  flex-shrink: 0;
}
.st.st.st .pg-pct {
  width: 96px;
  flex-shrink: 0;
}
.st.st.st :is(.pg-hex, .pg-pct) input {
  width: 100%;
  min-width: 0;
}
.pg-sw {
  display: inline-block;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 16%, transparent);
}
.pg-sw.is-sm {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
.pg-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}

/* Tokens */
.stt-row,
.stl-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 0;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
.stt-line {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0.72;
}
.stt-line.is-on,
.stl-row .stt-line {
  opacity: 1;
}
.stt-m {
  width: 34px;
  flex-shrink: 0;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.stt-out {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  margin: -2px 0 2px 40px;
  color: var(--color-muted-foreground);
}
.stl-fixed {
  flex: 1;
}

/* Integrate */
.sti-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
.sti-sw {
  display: flex;
  gap: 3px;
}
.sti-main {
  min-width: 0;
  flex: 1;
}
.sti-tag {
  flex-shrink: 0;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
.sti-tag.is-changes {
  color: var(--color-base-foreground);
}
.sti-tag.is-new {
  color: var(--color-status-running);
}
.sti-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 0;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
.sti-block .is-fail {
  color: var(--color-status-danger);
}
.sti-block .is-pass {
  color: var(--color-muted-foreground);
}

/* Primitives */
.stp-scale {
  display: grid;
  grid-template-columns: repeat(11, minmax(0, 1fr));
  gap: 4px;
}
.stp-step {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.stp-chip {
  display: flex;
  width: 100%;
  height: 40px;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 4px;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  font-size: 10.5px;
  font-weight: 500;
}
.stp-l {
  height: 110px;
  writing-mode: vertical-lr;
  direction: rtl;
  accent-color: var(--color-base-foreground);
}
.stp-step output,
.stp-knob output {
  color: var(--color-subtle-foreground);
  font-family: var(--ds-mono);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.stp-curve {
  width: 100%;
  height: 64px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
.stp-curve polyline {
  fill: none;
  stroke: var(--color-base-foreground);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.stp-knobs {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.stp-knob {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  color: var(--color-muted-foreground);
}
.stp-knob span {
  width: 52px;
}
.stp-knob input {
  flex: 1;
  accent-color: var(--color-base-foreground);
}
.stp-knob output {
  width: 56px;
}
.stp-hues {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.stp-hue {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
.stp-hue input[type='color'] {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.stp-hue input[type='color']::-webkit-color-swatch-wrapper {
  padding: 0;
}
.stp-hue input[type='color']::-webkit-color-swatch {
  border: 0;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
.stp-hue-name {
  min-width: 0;
  flex: 1;
}

/* Contrast */
.stc-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  color: var(--color-muted-foreground);
}
.stc-count {
  font-variant-numeric: tabular-nums;
}
.stc-count.is-fail {
  color: var(--color-status-danger);
}
.stc-head,
.stc-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 128px 128px;
  align-items: center;
  gap: 8px;
}
.stc-head {
  color: var(--color-subtle-foreground);
  font-size: 11px;
}
.stc-row {
  padding: 6px 0;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
.stc-pair {
  min-width: 0;
}
.stc-score {
  display: flex;
  align-items: center;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}
.stc-score code {
  width: 30px;
  font-size: 11.5px;
  text-align: right;
}
.stc-score.is-pass svg {
  color: var(--color-status-running);
}
.stc-score.is-fail svg,
.stc-score code.is-off {
  color: var(--color-status-danger);
}
.stc-sample {
  display: inline-flex;
  width: 30px;
  height: 22px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  font-size: 12px;
  font-weight: 500;
}
</style>
