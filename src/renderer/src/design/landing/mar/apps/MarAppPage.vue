<script setup lang="ts">
import { appExamplesAt } from './appPage'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { onClickOutside, useResizeObserver } from '@vueuse/core'
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronsLeftRight,
  Coins,
  Columns2,
  Download,
  Ellipsis,
  Globe,
  Image as ImageIcon,
  ImageUp,
  Link2,
  Loader2,
  Plus,
  Share2
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger, PopoverRoot, PopoverTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import PopoverContent from '../../ui/PopoverContent.vue'
import Switch from '../../ui/Switch.vue'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import { cn } from '../../ui/cn'
import { thumb } from '../../mock'
import { toast } from '../../useProto'
import { appsProto, isAdded, libApp, toggleAdded, type Field } from '../../appFlow'
import { examplesOf, openOn, type AppExample } from './appExamples'

/**
 * An app opens straight into its editor, as in the Hub's full-screen apps
 * (the shared editor kit, ComfyUI_frontend #20630, previewed with every app
 * in #20663), laid out as two blocks of one height under a header: the
 * header has Back and the name, and Compare, Share and Download on the
 * right; the panel on the left holds what you give it, with Run and its
 * credits at its foot; the stage on the right frames the result, centred,
 * with a dock under it for your takes. No dot grid: that's the graph's.
 * An example opens loaded: its picture in the panel, its result on the
 * canvas, so you see what the app does before you run it.
 */
const {
  appId,
  name,
  thumbId,
  fields,
  cost,
  payer,
  gate,
  output = 'image'
} = defineProps<{
  appId: string
  name: string
  thumbId: string
  fields: Field[]
  cost: number
  payer: string
  gate?: () => boolean
  output?: string
}>()
const emit = defineEmits<{ done: [] }>()
// The themed page's props (author, layout, theme) come along; they don't
// apply here.
defineOptions({ inheritAttrs: false })

// Its examples, to start from like templates: the one picked in Apps ›
// Examples, else its first. Picking one loads its picture, its words and
// its result.
const examples = computed(() => examplesOf(appId))
const exId = ref(openOn[appId] ?? examples.value[0]?.id)
const example = computed(() => examples.value.find((x) => x.id === exId.value))
const kind = computed(() => example.value?.kind ?? (output === 'video' ? 'Video' : 'Image'))
const made = computed(() => kind.value.toLowerCase())
/** What goes in: the example's own picture, or the app's cover. */
const input = computed(() => example.value?.src ?? thumb(thumbId))
/** What comes out: only an example has one to show before a run. */
const sample = computed(() => example.value?.after)

// An example always starts from its picture; an app whose inputs are words
// alone gets it as the first, so Compare has a before.
const shown = computed<Field[]>(() => {
  const on = fields.filter((f) => f.on)
  if (!example.value || on.some((f) => f.kind === 'image')) return on
  const label = example.value.kind === 'Video' ? 'Your clip' : 'Your photo'
  return [{ id: 'source', label, kind: 'image', node: 'Load Image #1', on: true }, ...on]
})
// Only the first picture input has the example's picture; any other waits
// for yours.
const firstImage = computed(() => shown.value.find((f) => f.kind === 'image')?.id)
const values = reactive<Record<string, string>>({})
const firstText = computed(() => shown.value.find((f) => f.kind === 'text')?.id)
function load(x: AppExample | undefined): void {
  if (firstText.value) values[firstText.value] = x?.prompt ?? ''
}
load(example.value)
// The examples strip over the stage (UI Playground › App examples).
const onStage = computed(() => appExamplesAt.id === 'stage' && examples.value.length > 1)
function pickExample(x: AppExample): void {
  if (state.value === 'running') return
  exId.value = x.id
  state.value = 'idle'
  comparing.value = false
  load(x)
}
const pick = (f: Field): string => values[f.id] ?? f.options?.[0] ?? ''
const count = computed(() =>
  Number(pick(fields.find((f) => f.kind === 'count') ?? ({} as Field)) || 1)
)

const state = ref<'idle' | 'running' | 'done'>('idle')
const progress = ref(0)
const STEPS = ['Queued', 'Running on Comfy Cloud', 'Saving the result']
// Mock variations of the one result: each is a take you can pick.
const LOOKS = [
  'none',
  'contrast(1.12) saturate(1.15)',
  'sepia(0.3) saturate(1.3) hue-rotate(-12deg)',
  'brightness(1.08) saturate(0.85)'
]
const takes = computed(() => LOOKS.slice(0, count.value))
const take = ref(0)
const result = computed(() => sample.value ?? input.value)
/** What the stage shows: your take once you've run it, else the example's. */
const shownFilter = computed(() => (state.value === 'done' ? takes.value[take.value] : 'none'))
/** Zoom, as in the asset modal: `zoom` scales the fitted picture (100 =
 *  fit); the control reads in real size. */
const zoom = ref(100)
const pic = ref<HTMLImageElement>()
const fit = ref(1)
function measure(): void {
  const el = pic.value
  if (el?.naturalWidth) fit.value = el.clientWidth / el.naturalWidth
}
const shownPct = computed(() => Math.round(fit.value * zoom.value))
const ZOOMS = [50, 100, 200]
const zoomMenu = ref(false)
const zoomBox = ref<HTMLElement>()
onClickOutside(zoomBox, () => (zoomMenu.value = false))
function zoomTo(pct?: number): void {
  zoom.value = pct ? Math.min(800, Math.max(10, pct / fit.value)) : 100
  zoomMenu.value = false
}
useResizeObserver(pic, measure)
watch(take, () => (zoom.value = 100))
const hasResult = computed(() => state.value === 'done' || Boolean(sample.value))

// Comfy credits: 211 to the dollar. A run on this computer is free.
const CREDITS_PER_USD = 211
const credits = computed(() =>
  cost ? Math.max(1, Math.round(cost * count.value * CREDITS_PER_USD)) : 0
)

// Compare: the before over the result, split where you drag.
const comparing = ref(false)
const split = ref(50)

// While it runs: how far along, and for how long.
const RUN_MS = 250 + (STEPS.length + 1) * 650
const pct = ref(0)
const secs = ref(0)
let clock: ReturnType<typeof setInterval> | undefined
onBeforeUnmount(() => clearInterval(clock))
function startClock(): void {
  const t0 = performance.now()
  clearInterval(clock)
  clock = setInterval(() => {
    const ms = performance.now() - t0
    pct.value = Math.min(99, Math.round((ms / RUN_MS) * 100))
    secs.value = Math.floor(ms / 1000)
    if (state.value !== 'running') clearInterval(clock)
  }, 80)
}
const stepNow = computed(() => STEPS[Math.max(0, progress.value - 1)])

function run(): void {
  if (state.value === 'running') return
  if (gate && !gate()) return
  comparing.value = false
  take.value = 0
  state.value = 'running'
  progress.value = 0
  pct.value = 0
  secs.value = 0
  startClock()
  const tick = (): void => {
    if (progress.value < STEPS.length) {
      progress.value++
      setTimeout(tick, 650)
    } else {
      state.value = 'done'
      emit('done')
    }
  }
  setTimeout(tick, 250)
}
defineExpose({ run })

// Share: the app's link, and once you've run it, your result with it.
const lib = computed(() => libApp(appId))
const slug = computed(() => lib.value?.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
const withResult = ref(true)
const link = computed(
  () => `comfy.org/a/${slug.value}${state.value === 'done' && withResult.value ? '?r=7f3k' : ''}`
)
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
function copy(): void {
  void navigator.clipboard?.writeText(`https://${link.value}`).catch(() => {})
  copied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1600)
}

// Who pays shows only when it isn't you at the price on Run: a team, a
// sponsor, or this computer.
const payerNote = computed(() => (/from your credits/i.test(payer) ? '' : payer))

// Back returns to the page the app opened from (Apps, Home, Explore),
// still under its tab.
function back(): void {
  appsProto.front = ''
}
</script>

<template>
  <div class="mar-app-editor mar-app-page text-base-foreground">
    <!-- Header: Back and the name; Compare, Share and Download on the
         right. No account: the title bar has it. -->
    <header class="mar-app-editor-bar">
      <div class="mar-app-editor-title">
        <Button variant="ghost" size="icon-sm" aria-label="Back to Explore" @click="back"
          ><ChevronLeft :size="16"
        /></Button>
        <h1 class="shrink-0 text-heading font-semibold">{{ name }}</h1>
      </div>
      <span class="flex-1" />
      <div class="mar-app-editor-actions">
        <!-- Compare and Share: icons alone, white on no fill. -->
        <Button
          v-if="hasResult && state !== 'running'"
          variant="ghost"
          size="icon-sm"
          aria-label="Compare before and after"
          title="Compare"
          :aria-pressed="comparing"
          :class="cn('mar-app-editor-icon', comparing && 'is-on')"
          @click="comparing = !comparing"
          ><Columns2 :size="16"
        /></Button>
        <PopoverRoot>
          <PopoverTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Share"
              title="Share"
              class="mar-app-editor-icon"
              ><Share2 :size="16"
            /></Button>
          </PopoverTrigger>
          <!-- Share: the app, its link to copy, and once you've run it,
               whether your result goes with it. -->
          <PopoverContent align="end" class="w-[340px] p-0">
            <div class="flex items-center gap-3 px-4 pt-4">
              <img
                :src="input"
                alt=""
                class="size-9 shrink-0 rounded-control border border-border-default object-cover"
              />
              <div class="min-w-0">
                <p class="truncate text-ui font-semibold">Share {{ name }}</p>
                <p class="text-ui text-muted-foreground">Anyone with the link can run it.</p>
              </div>
            </div>
            <div class="flex flex-col gap-3 px-4 pt-3 pb-4">
              <input
                :value="`https://${link}`"
                readonly
                tabindex="-1"
                aria-label="Link"
                class="h-8 w-full truncate rounded-control bg-secondary-background px-2.5 font-mono text-[11px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                @focus="($event.target as HTMLInputElement).select()"
              />
              <label v-if="state === 'done'" class="flex items-center justify-between gap-3">
                <span class="min-w-0">
                  <span class="block text-ui">Include your result</span>
                  <span class="block text-ui text-subtle-foreground"
                    >They see what you made before they run it.</span
                  >
                </span>
                <Switch v-model="withResult" aria-label="Include your result" />
              </label>
            </div>
            <div
              class="flex items-center justify-between gap-2 border-t border-border-default px-4 py-3"
            >
              <span class="flex items-center gap-1.5 text-ui text-subtle-foreground"
                ><Globe :size="13" />Runs on their credits</span
              >
              <Button variant="secondary" size="sm" @click="copy"
                ><Check v-if="copied" :size="13" /><Link2 v-else :size="13" />{{
                  copied ? 'Copied' : 'Copy link'
                }}</Button
              >
            </div>
          </PopoverContent>
        </PopoverRoot>
        <!-- Download only once there is something of yours to download. -->
        <Button
          v-if="state === 'done'"
          variant="primary"
          size="sm"
          class="ml-1"
          @click="toast('Downloading…')"
          ><Download :size="13" />Download</Button
        >
        <!-- More: what you'd do now and then, out of the way. -->
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" aria-label="More"
              ><Ellipsis :size="16"
            /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-52">
            <DropdownMenuItem v-if="lib" @select="toggleAdded(lib)"
              ><Check v-if="isAdded(appId)" :size="14" /><Plus v-else :size="14" />{{
                isAdded(appId) ? 'In my apps' : 'Add to my apps'
              }}</DropdownMenuItem
            >
            <DropdownMenuItem @select="copy"><Link2 :size="14" />Copy link</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </div>
    </header>

    <div class="mar-app-editor-body">
      <!-- Panel: what you give it, and Run at its foot -->
      <aside class="mar-app-editor-panel" aria-label="Input">
        <div class="mar-app-editor-fields">
          <!-- UI Playground › App examples › Panel: the same strip, at the
               top of the panel, before what you give it. -->
          <div
            v-if="appExamplesAt.id === 'panel' && state === 'idle' && examples.length > 1"
            class="mar-app-editor-dock is-examples is-in-panel"
            role="group"
            aria-label="Examples"
          >
            <button
              v-for="x in examples.slice(0, 5)"
              :key="x.id"
              type="button"
              :title="x.title"
              :aria-label="x.title"
              :aria-pressed="x.id === exId"
              :class="cn('mar-app-editor-take', x.id === exId && 'is-on')"
              @click="pickExample(x)"
            >
              <img :src="x.after" alt="" />
            </button>
          </div>
          <section v-for="f in shown" :key="f.id" class="mar-app-editor-field">
            <h2 class="mar-app-editor-label">{{ f.label }}</h2>
            <button
              v-if="f.kind === 'image' && f.id === firstImage"
              type="button"
              class="mar-app-editor-source group"
              :aria-label="`Replace ${f.label.toLowerCase()}`"
              @click="toast('Pick an image')"
            >
              <img :src="input" alt="" class="size-full object-cover" />
              <span class="mar-app-editor-replace"><ImageUp :size="14" />Replace</span>
            </button>
            <button
              v-else-if="f.kind === 'image'"
              type="button"
              class="mar-app-editor-drop"
              @click="toast('Pick an image')"
            >
              <ImageUp :size="16" />
              <span>Add {{ f.label.toLowerCase() }}</span>
            </button>
            <textarea
              v-else-if="f.kind === 'text'"
              :value="values[f.id] ?? ''"
              :placeholder="f.placeholder ?? ''"
              rows="3"
              class="mar-app-editor-text"
              @input="values[f.id] = ($event.target as HTMLTextAreaElement).value"
            />
            <SegmentedControl
              v-else
              :model-value="pick(f)"
              variant="contained"
              size="sm"
              class="self-start"
              :options="(f.options ?? []).map((o) => ({ value: o, label: o }))"
              @update:model-value="(v: string) => (values[f.id] = v)"
            />
          </section>
          <slot name="place" />
        </div>

        <!-- Run: the label, and what a run costs in credits -->
        <footer class="mar-app-editor-foot">
          <button
            type="button"
            class="mar-app-editor-run"
            :disabled="state === 'running'"
            :title="payer"
            @click="run"
          >
            <span class="flex items-center gap-2">
              <Loader2 v-if="state === 'running'" :size="15" class="animate-spin" />
              {{ state === 'running' ? 'Running' : 'Run' }}
            </span>
            <span class="mar-app-editor-cost">
              <template v-if="credits"><Coins :size="14" />{{ credits }}</template>
              <template v-else>Free</template>
            </span>
          </button>
          <p v-if="payerNote" class="mar-app-editor-payer">{{ payerNote }}</p>
        </footer>
      </aside>
      <!-- Stage: the result, the example's until you run it (its examples
             over it), centred in its frame; your takes under it -->
      <main
        :class="cn('mar-app-editor-stage', appExamplesAt.id === 'panel' && 'is-examples-in-panel')"
        aria-label="Output"
      >
        <div class="mar-app-editor-canvas">
          <!-- Examples, on the top line of the picture's room: up to five
               of what this app has made, to start from like templates.
               Picking one fills the panel and shows its result; once you
               run, they go. -->
          <div
            v-if="state === 'idle' && onStage"
            class="mar-app-editor-dock is-examples"
            role="group"
            aria-label="Examples"
          >
            <button
              v-for="x in examples.slice(0, 5)"
              :key="x.id"
              type="button"
              :title="x.title"
              :aria-label="x.title"
              :aria-pressed="x.id === exId"
              :class="cn('mar-app-editor-take', x.id === exId && 'is-on')"
              @click="pickExample(x)"
            >
              <img :src="x.after" alt="" />
            </button>
          </div>
          <figure
            v-if="hasResult"
            :class="cn('mar-app-editor-pic', state === 'running' && 'is-running')"
          >
            <img
              ref="pic"
              :key="state === 'done' ? `take-${take}` : 'example'"
              :src="result"
              alt=""
              :class="state === 'done' && 'mar-app-editor-rise'"
              :style="{ filter: shownFilter, scale: state === 'done' ? zoom / 100 : 1 }"
              @load="measure"
            />
            <template v-if="comparing && state !== 'running'">
              <img
                :src="input"
                alt=""
                class="mar-app-editor-before"
                :style="{ clipPath: `inset(0 ${100 - split}% 0 0)` }"
              />
              <span class="mar-app-editor-handle" :style="{ left: `${split}%` }">
                <span><ChevronsLeftRight :size="14" /></span>
              </span>
              <input
                v-model.number="split"
                type="range"
                min="0"
                max="100"
                aria-label="Before and after"
                class="mar-app-editor-split"
              />
              <Badge variant="overlay" size="md" class="absolute bottom-3 left-3">Before</Badge>
              <Badge variant="overlay" size="md" class="absolute right-3 bottom-3">After</Badge>
            </template>
            <!-- No examples over it (one example, or they're in the panel):
                 the picture says it's an example. -->
            <Badge
              v-if="state === 'idle' && !onStage"
              variant="overlay"
              size="md"
              class="absolute top-3 left-3"
              >Example</Badge
            >
          </figure>

          <!-- Nothing yet -->
          <div v-else-if="state === 'idle'" class="mar-app-editor-empty">
            <span><ImageIcon :size="18" /></span>
            <p class="text-heading font-medium">Your {{ made }} appears here</p>
            <p class="text-ui text-muted-foreground">Fill in the panel, then Run.</p>
          </div>

          <!-- Running: the steps over the blurred picture -->
          <!-- Running: a light sweeps the picture; one card says what's
               happening, for how long, and how far along. -->
          <span
            v-if="state === 'running' && hasResult"
            class="mar-app-editor-sweep"
            aria-hidden="true"
          />
          <div v-if="state === 'running'" class="mar-app-editor-gen" role="status">
            <span class="flex items-center justify-between gap-6">
              <span class="flex items-center gap-2 font-medium"
                ><Loader2 :size="14" class="animate-spin" />{{ stepNow }}</span
              >
              <span class="text-subtle-foreground tabular-nums">{{ secs }} s</span>
            </span>
            <span class="mar-app-editor-bar-track"><span :style="{ width: `${pct}%` }" /></span>
            <span class="text-[12px] text-subtle-foreground tabular-nums"
              >{{ pct }}% · {{ count }} {{ count === 1 ? made : `${made}s` }}</span
            >
          </div>
        </div>

        <!-- Once you've run it, along the bottom as in the asset modal:
             your takes from the left, how it went in the middle, the zoom
             on the right. -->
        <div v-if="state === 'done'" class="mar-app-editor-outbar">
          <nav class="mar-app-editor-takes" aria-label="Your takes">
            <template v-if="takes.length > 1">
              <button
                v-for="(filter, i) in takes"
                :key="filter"
                type="button"
                :aria-label="`Take ${i + 1}`"
                :aria-current="take === i"
                class="mar-app-editor-thumb"
                @click="take = i"
              >
                <img :src="result" alt="" :style="{ filter }" />
              </button>
            </template>
          </nav>
          <div class="mar-app-editor-dock">
            <span class="mar-app-editor-done"
              ><Check :size="14" />{{ takes.length }}
              {{ takes.length === 1 ? made : `${made}s` }} in 18 s</span
            >
            <span v-if="$slots.saved" class="mar-app-editor-saved"
              ><slot name="saved" /><ArrowRight :size="13"
            /></span>
          </div>
          <div ref="zoomBox" class="mar-app-editor-zoom" role="group" aria-label="Zoom">
            <button
              type="button"
              class="mar-app-editor-zoom-pct"
              aria-haspopup="menu"
              :aria-expanded="zoomMenu"
              @click="zoomMenu = !zoomMenu"
            >
              <span>{{ shownPct }}%</span><ChevronDown :size="13" />
            </button>
            <div v-if="zoomMenu" class="mar-app-editor-zoom-menu" role="menu">
              <button type="button" role="menuitem" @click="zoomTo()">Fit to screen</button>
              <button v-for="z in ZOOMS" :key="z" type="button" role="menuitem" @click="zoomTo(z)">
                {{ z }}%
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
    <slot name="below" />
  </div>
</template>

<style scoped>
.mar-app-editor {
  --panel: clamp(300px, 30vw, 360px);
  --edge: 12px;
  display: grid;
  height: 100%;
  min-height: 560px;
  grid-template-rows: auto minmax(0, 1fr);
  /* No gap under the header: its 56 px centre the title on its own. */
  padding: 0 var(--edge) var(--edge);
  overflow: hidden;
  background: var(--color-app-background);
}

/* Header */
.mar-app-editor-bar {
  display: flex;
  height: 56px;
  padding: 0 4px;
  align-items: center;
  gap: 8px;
}
/* Two blocks of one height: the panel, and the stage beside it. */
.mar-app-editor-body {
  display: grid;
  min-height: 0;
  grid-template-columns: var(--panel) minmax(0, 1fr);
  gap: var(--edge);
}
.mar-app-editor-title,
.mar-app-editor-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.mar-app-editor-actions {
  flex-shrink: 0;
  gap: 10px;
}

/* Panel */
.mar-app-editor-panel {
  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-panel);
  background: var(--color-card-background);
}
.mar-app-editor-fields {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.mar-app-editor-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 20px 14px;
}
.mar-app-editor-field + .mar-app-editor-field {
  border-top: 1px solid var(--color-border-default);
}
.mar-app-editor-label {
  font-size: var(--text-ui);
  line-height: var(--text-ui--line-height);
  font-weight: 500;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-source {
  position: relative;
  display: block;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
  outline: none;
}
.mar-app-editor-source:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mar-app-editor-replace {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgb(0 0 0 / 0.5);
  color: white;
  font-size: var(--text-ui);
  font-weight: 500;
  opacity: 0;
  transition: opacity 150ms;
}
.mar-app-editor-source:hover .mar-app-editor-replace,
.mar-app-editor-source:focus-visible .mar-app-editor-replace {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-drop {
  display: flex;
  aspect-ratio: 16 / 10;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-card);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  transition: color 150ms;
}
.mar-app-editor-drop:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-text {
  width: 100%;
  resize: none;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
  font-size: var(--text-ui);
  line-height: var(--text-ui--line-height);
  outline: none;
  transition: border-color 150ms;
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-text:focus {
  border-color: var(--color-border-strong);
}
.mar-app-editor-text::placeholder {
  color: var(--color-subtle-foreground);
}
.mar-app-editor-foot {
  flex-shrink: 0;
  margin-top: auto;
  padding: 12px 20px 20px;
  border-top: 1px solid var(--color-border-default);
}
/* Run: the one white button, its label left and the cost right. */
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-run {
  display: flex;
  width: 100%;
  height: 40px;
  align-items: center;
  justify-content: space-between;
  padding: 0 5px 0 14px;
  border-radius: var(--radius-card);
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: var(--text-heading);
  font-weight: 600;
  transition:
    background-color 150ms,
    transform 150ms;
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-run:hover {
  background: var(--color-inverted-background-hover);
}
.mar-app-editor-run:active {
  transform: scale(0.99);
}
.mar-app-editor-run:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mar-app-editor-run:disabled {
  opacity: 0.6;
  pointer-events: none;
}
.mar-app-editor-cost {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--color-inverted-foreground) 10%, transparent);
  font-size: var(--text-ui);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.mar-app-editor-payer {
  margin-top: 8px;
  text-align: center;
  font-size: var(--text-ui);
  line-height: var(--text-ui--line-height);
  color: var(--color-subtle-foreground);
}

/* Stage: a frame of its own, plain: apps don't wear the editor's dots. */
.mar-app-editor-stage {
  position: relative;
  display: flex;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  /* Room for the examples across the top line, and a margin all round so
     the picture never fills the panel. */
  padding: 88px 72px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-panel);
  background: var(--color-card-background);
}
/* In the panel: in the flow, the panel's width, the thumbnails sharing it. */
.mar-app-editor-dock.is-examples.is-in-panel {
  position: static;
  width: 100%;
  height: auto;
  justify-content: flex-start;
  transform: none;
}
:root
  .proto-ui.proto-ui.proto-ui
  .mar-app-editor-dock.is-examples.is-in-panel
  .mar-app-editor-take {
  width: auto;
  height: auto;
  /* Five slots, square, however many the app has. */
  flex: 0 0 calc((100% - 24px) / 5);
  aspect-ratio: 1;
}
/* No strip over the stage: the same margin all round. */
.mar-app-editor-stage.is-examples-in-panel {
  padding-block: 72px;
}
/* With your takes under the picture, they share the bottom margin. */
/* Along the bottom, as in the asset modal. */
.mar-app-editor-outbar {
  position: absolute;
  right: 24px;
  bottom: 18px;
  left: 24px;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 16px;
}
.mar-app-editor-takes {
  display: flex;
  min-width: 0;
  gap: 6px;
  overflow-x: auto;
  padding: 4px;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-thumb {
  width: 44px;
  height: 44px;
  flex: none;
  overflow: hidden;
  padding: 0;
  border-radius: 8px;
  background: var(--color-secondary-background);
  opacity: 0.55;
  transition:
    opacity 0.12s ease,
    box-shadow 0.12s ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-thumb:hover {
  opacity: 0.9;
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-thumb[aria-current='true'] {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-base-foreground);
  opacity: 1;
}
.mar-app-editor-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mar-app-editor-zoom {
  position: relative;
  display: flex;
  justify-self: end;
  padding: 3px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-zoom-pct {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 10px;
  border-radius: 7px;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-zoom-pct span {
  min-width: 34px;
  text-align: center;
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-zoom-pct:hover,
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-zoom-pct[aria-expanded='true'] {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mar-app-editor-zoom-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  display: grid;
  min-width: 140px;
  padding: 4px;
  border-radius: 10px;
  background: var(--color-secondary-background);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-zoom-menu button {
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 13px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-zoom-menu button:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mar-app-editor-canvas {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  container-type: size;
}
/* The picture sizes the frame, so tags and Compare sit on the picture. */
.mar-app-editor-pic {
  position: relative;
  margin: 0;
  overflow: hidden;
  border-radius: var(--radius-card);
  box-shadow:
    0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent),
    0 16px 40px rgb(0 0 0 / 0.22);
  transition: filter 500ms;
}
.mar-app-editor-pic > img:first-child {
  display: block;
  max-width: 100cqw;
  max-height: 100cqh;
}
.mar-app-editor-pic.is-running {
  filter: blur(14px) brightness(0.55);
}
.mar-app-editor-before {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mar-app-editor-handle {
  pointer-events: none;
  position: absolute;
  inset-block: 0;
  width: 2px;
  translate: -50% 0;
  background: white;
}
.mar-app-editor-handle > span {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  width: 28px;
  height: 28px;
  translate: -50% -50%;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: white;
  color: black;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
}
.mar-app-editor-split {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: ew-resize;
  opacity: 0;
}
.mar-app-editor-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}
.mar-app-editor-empty > span {
  display: flex;
  width: 40px;
  height: 40px;
  margin-bottom: 8px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
/* Running: one card over the blurred picture. */
.mar-app-editor-gen {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  width: 280px;
  translate: -50% -50%;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border-radius: 16px;
  background: oklch(0.2 0 0 / 0.62);
  backdrop-filter: blur(16px);
  font-size: var(--text-ui);
}
.mar-app-editor-bar-track {
  display: block;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: oklch(1 0 0 / 0.12);
}
.mar-app-editor-bar-track > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-base-foreground);
  transition: width 120ms linear;
}
/* A soft band of light that crosses the picture, top to bottom. */
.mar-app-editor-sweep {
  pointer-events: none;
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    oklch(1 0 0 / 0.07) 45%,
    oklch(1 0 0 / 0.14) 50%,
    oklch(1 0 0 / 0.07) 55%,
    transparent 100%
  );
  background-size: 100% 220%;
  animation: mar-app-editor-sweep 1.8s ease-in-out infinite;
}
@keyframes mar-app-editor-sweep {
  from {
    background-position: 0 100%;
  }
  to {
    background-position: 0 -120%;
  }
}
/* Done: the takes, then what it made and where it went, as one quiet pill. */
.mar-app-editor-dock {
  display: flex;
  max-width: 100%;
  height: 38px;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 4px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  white-space: nowrap;
}
/* Examples: centred on the canvas's top line (the most the picture can
   reach), on dark glass. */
.mar-app-editor-dock.is-examples {
  position: absolute;
  top: 0;
  left: 50%;
  z-index: 2;
  height: 56px;
  gap: 6px;
  padding: 6px;
  /* Squarer: the thumbnails' corners plus the padding. */
  border-radius: 16px;
  transform: translate(-50%, -50%);
  background: oklch(0.16 0.004 285 / 0.62);
  backdrop-filter: blur(16px) saturate(1.3);
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-dock.is-examples .mar-app-editor-take {
  width: 44px;
  height: 44px;
  border-radius: 10px;
}
.mar-app-editor-dock.is-examples .mar-app-editor-dock-label {
  color: oklch(1 0 0 / 0.75);
}
.mar-app-editor-dock-label {
  flex-shrink: 0;
  margin-right: 4px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
.mar-app-editor-done {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
.mar-app-editor-done > svg {
  color: var(--color-status-running, #3ccf7a);
}
.mar-app-editor-saved {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 2px;
  padding: 0 10px 0 2px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
.mar-app-editor-saved :deep(button) {
  height: 30px;
  padding-inline: 10px 4px;
  color: inherit;
  text-decoration: none;
}
/* Header icons: white, never a fill; hover dims them. */
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-icon {
  background: transparent;
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-icon:hover {
  background: transparent;
  opacity: 0.7;
}
.mar-app-editor-rule {
  width: 1px;
  height: 16px;
  margin: 0 2px;
  background: var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-take {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: var(--radius-min);
  opacity: 0.55;
  transition: opacity 150ms;
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-take.is-on {
  opacity: 1;
  box-shadow: 0 0 0 2px var(--color-base-foreground);
}
.mar-app-editor-take img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mar-app-editor-rise {
  animation: mar-app-editor-rise 500ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes mar-app-editor-rise {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-app-editor-rise {
    animation: none;
  }
  .mar-app-editor-pic {
    transition: none;
  }
  .mar-app-editor-sweep {
    animation: none;
  }
}
</style>
