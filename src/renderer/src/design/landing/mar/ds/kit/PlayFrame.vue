<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TooltipProvider } from 'reka-ui'
import { Bell, Check, Copy, Link, Pencil, Trash2 } from 'lucide-vue-next'
import lakeFog from '../../assets/lake-fog.jpg'
import portraitSun from '../../assets/portrait-sun.jpg'
import { thumb } from '../../../mock'
import Button from '../../../ui/Button.vue'
import Input from '../../../ui/Input.vue'
import Select from '../../../ui/Select.vue'
import Switch from '../../../ui/Switch.vue'
import Tooltip from '../../../ui/Tooltip.vue'
import LaunchBanner from '../../LaunchBanner.vue'
import WorkflowCard from '../../WorkflowCard.vue'
import { ComfyWorkflow } from '../../icons/comfyIcons'
import MarEmpty from '../../pages/MarEmpty.vue'
import { EMPTY_PICS } from '../../pages/emptyArt'
import MarItem from '../../pages/MarItem.vue'
import MarSeg from '../../pages/MarSeg.vue'
import MarStatus, { type ItemStatus } from '../../pages/MarStatus.vue'
import type { MenuLine } from '../../pages/menu'
import {
  filled,
  GROUPS,
  groupOf,
  highlight,
  importLine,
  labelOf,
  SPECS,
  usage,
  type Value
} from '../play'

/**
 * A component's Playground tab (pages/PlaygroundTab.vue), drawn with Mar's
 * own components in this frame's theme: the knobs, the component on a
 * stage, an inspector for its props, and its usage. The page keeps the
 * state (and the link); theme and corners rebuild this frame, props
 * and background reach it as messages.
 */
const url = new URLSearchParams(location.search)
const id = url.get('c') ?? 'button'
const values = ref<Record<string, Value>>(JSON.parse(url.get('p') ?? '{}'))
const bg = ref(url.get('bg') === 'image' ? 'image' : 'page')
const theme = ref(url.get('theme') === 'light' ? 'light' : 'dark')
const corners = ref(url.get('corners') === 'default' ? 'default' : 'soft')

const spec = computed(() => SPECS.find((s) => s.id === id) ?? SPECS[0]!)
const v = computed(() => filled(spec.value, values.value))
const s = (k: string): string => String(v.value[k] ?? '')
const b = (k: string): boolean => Boolean(v.value[k])

// The page holds the state: every change goes up.
function post(): void {
  parent.postMessage(
    {
      type: 'mar-ds:play-state',
      p: { ...values.value },
      bg: bg.value,
      theme: theme.value,
      corners: corners.value
    },
    '*'
  )
}
watch([values, bg, theme, corners], post, { deep: true })
function set(name: string, value: Value): void {
  values.value = { ...values.value, [name]: value }
}

const KNOBS = [
  { key: 'theme', label: 'Theme', model: theme, options: ['dark', 'light'] },
  { key: 'corners', label: 'Corners', model: corners, options: ['soft', 'default'] },
  { key: 'bg', label: 'Background', model: bg, options: ['page', 'image'] }
] as const
const opts = (o: readonly string[]): { value: string; label: string }[] =>
  o.map((x) => ({ value: x, label: x[0]!.toUpperCase() + x.slice(1) }))

const groups = computed(() =>
  GROUPS.map((g) => ({ g, controls: spec.value.controls.filter((c) => groupOf(c) === g) })).filter(
    (x) => x.controls.length
  )
)

// What a control stands for, made into the prop.
const LINES: MenuLine[] = [
  { label: 'Rename', icon: Pencil },
  'sep',
  { label: 'Delete', icon: Trash2, danger: true }
]
const tabs = computed(() =>
  s('tabs')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label) => ({ value: label.toLowerCase().replace(/\W+/g, '-'), label }))
)
const tab = ref('')
const picked = computed({
  get: () =>
    tabs.value.some((t) => t.value === tab.value) ? tab.value : (tabs.value[0]?.value ?? ''),
  set: (x: string) => (tab.value = x)
})
// “grid” → “Grid”, “md” → “MD”, empty → “None”.
const optionLabel = (o: string): string =>
  !o ? 'None' : o.length <= 2 ? o.toUpperCase() : o[0]!.toUpperCase() + o.slice(1)
const status = computed(() => (s('status') || undefined) as ItemStatus | undefined)
const tone = computed(() => (s('tone') === 'error' ? 'error' : undefined))
const renamed = ref('')

const code = computed(() => `${importLine(spec.value)}\n\n${usage(spec.value, values.value)}`)
const copied = ref('')
async function copy(what: 'code' | 'link'): Promise<void> {
  // The page shares this origin: its address is the link to this state.
  await navigator.clipboard.writeText(what === 'code' ? code.value : parent.location.href)
  copied.value = what
  setTimeout(() => (copied.value = ''), 1400)
}

// The page sizes this frame to its content.
const root = ref<HTMLElement>()
let ro: ResizeObserver | undefined
onMounted(() => {
  const h = (): void =>
    parent.postMessage({ type: 'mar-ds:height', h: Math.ceil(root.value!.offsetHeight) }, '*')
  ro = new ResizeObserver(h)
  ro.observe(root.value!)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div ref="root" class="proto-ui pg">
      <div class="pg-knobs">
        <div v-for="k in KNOBS" :key="k.key" class="pg-knob">
          <span>{{ k.label }}</span>
          <MarSeg v-model="k.model.value" :options="opts(k.options)" :label="k.label" />
        </div>
      </div>

      <div class="pg-body">
        <div
          :class="['pg-stage', `is-${bg}`, `is-${spec.id}`]"
          :style="bg === 'image' ? { backgroundImage: `url(${lakeFog})` } : undefined"
        >
          <div :class="['pg-fit', s('layout') === 'list' && 'is-list']">
            <Button
              v-if="spec.id === 'button'"
              :variant="s('variant') as 'primary'"
              :size="s('size') as 'md'"
              :disabled="b('disabled')"
              >{{ s('label') }}</Button
            >
            <MarStatus
              v-else-if="spec.id === 'status'"
              :status="s('status') as ItemStatus"
              :label="s('label') || undefined"
              :on-media="b('on-media')"
            />
            <MarItem
              v-else-if="spec.id === 'item'"
              :name="renamed || s('name')"
              :meta="s('meta')"
              :layout="s('layout') as 'grid'"
              :status
              :thumb="b('picture') ? thumb('image_flux2') : undefined"
              :icon="ComfyWorkflow"
              :selecting="b('selecting')"
              :selected="b('selected')"
              :renaming="b('renaming')"
              fav-id="image_flux2"
              fav-kind="template"
              :lines="LINES"
              @rename="renamed = $event"
            />
            <WorkflowCard
              v-else-if="spec.id === 'card'"
              :src="portraitSun"
              :title="s('title')"
              :meta="s('meta')"
              :right="s('right') || undefined"
            />
            <MarEmpty
              v-else-if="spec.id === 'empty'"
              :icon="ComfyWorkflow"
              :title="s('title')"
              :text="s('text')"
              :action="s('action') || undefined"
              :second="s('second') || undefined"
              :pics="b('pictures') ? EMPTY_PICS.workflows : []"
              :compact="b('compact')"
              :tone
            />
            <MarSeg
              v-else-if="spec.id === 'tabs'"
              v-model="picked"
              :options="tabs"
              :label="s('label')"
            />
            <Tooltip
              v-else-if="spec.id === 'tooltip'"
              :content="s('content')"
              :side="s('side') as 'bottom'"
            >
              <Button variant="ghost" size="icon-sm" :aria-label="s('content')"
                ><Bell :size="15"
              /></Button>
            </Tooltip>
            <LaunchBanner v-else-if="spec.id === 'banner'" />
          </div>
        </div>

        <aside v-if="groups.length" class="pg-inspector" aria-label="Props">
          <section v-for="g in groups" :key="g.g" class="pg-group">
            <h3>{{ g.g }}</h3>
            <label v-for="c in g.controls" :key="c.name" class="pg-row">
              <span>{{ labelOf(c) }}</span>
              <Input
                v-if="c.kind === 'text'"
                size="sm"
                :model-value="v[c.name] as string"
                @update:model-value="set(c.name, $event)"
              />
              <Select
                v-else-if="c.kind === 'select'"
                size="sm"
                :options="
                  c.options!.map((o) => ({
                    value: o || '-',
                    label: optionLabel(o)
                  }))
                "
                :model-value="(v[c.name] as string) || '-'"
                @update:model-value="set(c.name, $event === '-' ? '' : $event)"
              />
              <Switch
                v-else
                :aria-label="labelOf(c)"
                :model-value="v[c.name] as boolean"
                @update:model-value="set(c.name, $event)"
              />
            </label>
          </section>
        </aside>
      </div>

      <div class="pg-code">
        <div class="pg-code-head">
          <span>Usage</span>
          <Tooltip content="Copy usage">
            <Button variant="ghost" size="icon-xs" aria-label="Copy usage" @click="copy('code')">
              <component :is="copied === 'code' ? Check : Copy" :size="13" />
            </Button>
          </Tooltip>
          <Tooltip content="Copy link">
            <Button variant="ghost" size="icon-xs" aria-label="Copy link" @click="copy('link')">
              <component :is="copied === 'link' ? Check : Link" :size="13" />
            </Button>
          </Tooltip>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -- escaped in highlight() -->
        <pre><code v-html="highlight(code)" /></pre>
      </div>
    </div>
  </TooltipProvider>
</template>

<style>
html.ds-play-frame,
html.ds-play-frame body,
html.ds-play-frame #app {
  background: transparent;
}
.proto-ui.pg {
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* The playground is its theme's own surface, whatever the page is. */
  padding: 14px;
  border-radius: var(--radius-panel);
  background: var(--color-app-background);
  color: var(--color-base-foreground);
  font-size: 13px;
}
.pg-knobs {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px 16px;
}
.pg-knob {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pg-knob > span {
  color: var(--color-muted-foreground);
  font-size: 12px;
}
.pg-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  overflow: hidden;
  border-radius: var(--radius-panel);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.pg-stage {
  display: flex;
  min-height: 240px;
  align-items: center;
  justify-content: center;
  padding: 48px 32px;
  background-position: center;
  background-size: cover;
}
.pg-stage.is-page {
  background-color: var(--color-content-background);
  background-image: radial-gradient(
    color-mix(in oklch, var(--color-base-foreground) 10%, transparent) 1px,
    transparent 1.2px
  );
  background-size: 16px 16px;
}
.pg-fit {
  display: flex;
  max-width: 100%;
  justify-content: center;
}
.is-item .pg-fit {
  width: 260px;
}
.is-item .pg-fit.is-list {
  width: 520px;
}
.is-card .pg-fit {
  width: 300px;
}
.pg-stage:is(.is-empty, .is-banner) .pg-fit {
  width: 100%;
}
.pg-inspector {
  display: flex;
  flex-direction: column;
  border-left: 1px solid color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  background: color-mix(in oklch, var(--color-base-foreground) 2%, var(--color-content-background));
}
.pg-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
}
.pg-group + .pg-group {
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.pg-group h3 {
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-weight: 500;
}
.pg-row {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}
.pg-row > span {
  color: var(--color-muted-foreground);
  font-size: 12px;
}
.pg-row > :last-child:is(button[role='switch']) {
  justify-self: end;
}
.pg-code {
  overflow: hidden;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-base-foreground) 4%, var(--color-content-background));
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
.pg-code-head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px 4px 14px;
  border-bottom: 1px solid color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
.pg-code-head > span {
  margin-right: auto;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
.pg-code pre {
  overflow-x: auto;
  padding: 12px 14px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.pg-code .t-tag {
  color: oklch(0.78 0.1 250);
}
.pg-code .t-attr {
  color: oklch(0.8 0.09 155);
}
.pg-code .t-str {
  color: oklch(0.82 0.1 75);
}
.pg-code .t-kw {
  color: oklch(0.75 0.12 320);
}
[data-ds-theme='light'] .pg-code .t-tag {
  color: oklch(0.5 0.15 250);
}
[data-ds-theme='light'] .pg-code .t-attr {
  color: oklch(0.5 0.13 155);
}
[data-ds-theme='light'] .pg-code .t-str {
  color: oklch(0.55 0.13 60);
}
[data-ds-theme='light'] .pg-code .t-kw {
  color: oklch(0.5 0.16 320);
}
</style>
