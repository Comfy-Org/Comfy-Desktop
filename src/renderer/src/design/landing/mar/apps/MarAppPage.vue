<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  Check,
  ChevronLeft,
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
import { go, toast } from '../../useProto'
import { appsProto, isAdded, libApp, toggleAdded, type Field } from '../../appFlow'
import { EXAMPLES } from '../userStates/examples'

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
  blurb,
  thumbId,
  fields,
  cost,
  payer,
  gate,
  output = 'image'
} = defineProps<{
  appId: string
  name: string
  blurb: string
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

const example = computed(() => EXAMPLES.find((x) => x.app === appId))
const does = computed(() => example.value?.does ?? blurb)
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
const hasResult = computed(() => state.value === 'done' || Boolean(sample.value))

// Comfy credits: 211 to the dollar. A run on this computer is free.
const CREDITS_PER_USD = 211
const credits = computed(() =>
  cost ? Math.max(1, Math.round(cost * count.value * CREDITS_PER_USD)) : 0
)

// Compare: the before over the result, split where you drag.
const comparing = ref(false)
const split = ref(50)

function run(): void {
  if (state.value === 'running') return
  if (gate && !gate()) return
  comparing.value = false
  take.value = 0
  state.value = 'running'
  progress.value = 0
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

function back(): void {
  appsProto.front = ''
  go('explore')
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
        <h1 class="shrink-0 text-ui font-semibold">{{ name }}</h1>
        <span class="mar-app-editor-sep" aria-hidden="true" />
        <p class="min-w-0 truncate text-ui text-muted-foreground">{{ does }}</p>
      </div>
      <span class="flex-1" />
      <div class="mar-app-editor-actions">
        <Button
          v-if="hasResult"
          variant="ghost"
          size="sm"
          :aria-pressed="comparing"
          :disabled="state === 'running'"
          :class="comparing && 'bg-secondary-background text-base-foreground'"
          @click="comparing = !comparing"
          ><Columns2 :size="14" />Compare</Button
        >
        <PopoverRoot>
          <PopoverTrigger as-child>
            <Button variant="ghost" size="sm"><Share2 :size="14" />Share</Button>
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
        <Button
          variant="primary"
          size="sm"
          :disabled="state !== 'done'"
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
              {{ state === 'running' ? 'Running' : state === 'done' ? 'Run again' : 'Run' }}
            </span>
            <span class="mar-app-editor-cost">
              <template v-if="credits"><Coins :size="14" />{{ credits }}</template>
              <template v-else>Free</template>
            </span>
          </button>
          <p v-if="payerNote" class="mar-app-editor-payer">{{ payerNote }}</p>
        </footer>
      </aside>
      <!-- Stage: the result, the example's until you run it, centred in its
             frame; the dock under it -->
      <main class="mar-app-editor-stage" aria-label="Output">
        <div class="mar-app-editor-canvas">
          <figure
            v-if="hasResult"
            :class="cn('mar-app-editor-pic', state === 'running' && 'is-running')"
          >
            <img
              :key="state === 'done' ? `take-${take}` : 'example'"
              :src="result"
              alt=""
              :class="state === 'done' && 'mar-app-editor-rise'"
              :style="{ filter: shownFilter }"
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
            <Badge
              v-else-if="state === 'idle'"
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
          <ul v-if="state === 'running'" class="mar-app-editor-steps">
            <li
              v-for="(s, i) in STEPS"
              :key="s"
              :class="i < progress ? 'text-base-foreground' : 'text-subtle-foreground'"
            >
              <Check v-if="i < progress - 1" :size="14" class="text-status-running" />
              <Loader2 v-else-if="i === progress - 1" :size="14" class="animate-spin" />
              <span v-else class="size-3.5" />{{ s }}
            </li>
          </ul>
        </div>

        <!-- Dock: what's on the canvas, and your takes once you've run it -->
        <div v-if="state !== 'running'" class="mar-app-editor-dock">
          <template v-if="state === 'done'">
            <template v-if="takes.length > 1">
              <button
                v-for="(filter, i) in takes"
                :key="filter"
                type="button"
                :aria-label="`Take ${i + 1}`"
                :aria-pressed="take === i"
                :class="cn('mar-app-editor-take', take === i && 'is-on')"
                @click="take = i"
              >
                <img :src="result" alt="" :style="{ filter }" />
              </button>
              <span class="mar-app-editor-rule" aria-hidden="true" />
            </template>
            <span class="px-2 text-ui text-muted-foreground"
              >{{ takes.length }} {{ takes.length === 1 ? made : `${made}s` }} · 18 s</span
            >
            <slot name="saved" />
          </template>
          <span v-else-if="sample" class="px-2 text-ui text-muted-foreground"
            >An example of what it makes · Run to make yours</span
          >
          <span v-else class="px-2 text-ui text-muted-foreground">{{ does }}</span>
        </div>
      </main>
    </div>
    <slot name="below" />
  </div>
</template>

<style scoped>
.mar-app-editor {
  --panel: clamp(256px, 26vw, 304px);
  --edge: 12px;
  display: grid;
  height: 100%;
  min-height: 560px;
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--edge);
  padding: 8px var(--edge) var(--edge);
  overflow: hidden;
  background: var(--color-app-background);
}

/* Header */
.mar-app-editor-bar {
  display: flex;
  height: 36px;
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
  gap: 4px;
}
.mar-app-editor-sep {
  width: 1px;
  height: 14px;
  margin: 0 4px;
  background: var(--color-border-strong);
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
  padding: 14px 14px 12px;
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
  padding: 12px;
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
  display: flex;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px 32px 16px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-panel);
  background: var(--color-secondary-background);
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
.mar-app-editor-steps {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  translate: -50% -50%;
  flex-direction: column;
  gap: 8px;
  padding: 14px 18px;
  border-radius: var(--radius-card);
  background: var(--color-media-overlay);
  backdrop-filter: blur(8px);
  font-size: var(--text-ui);
}
.mar-app-editor-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  transition: color 200ms;
}
.mar-app-editor-dock {
  display: flex;
  max-width: 100%;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-card);
  background: var(--color-card-background);
  white-space: nowrap;
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
}
</style>
