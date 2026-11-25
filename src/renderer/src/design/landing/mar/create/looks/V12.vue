<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ImagePlus, Plus, RotateCcw, Search, Sparkles, X } from 'lucide-vue-next'
import Button from '../../../ui/Button.vue'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { hubById } from '../../explore/hubWorkflows'
import { activeInstance } from '../../../useProto'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { SHELVES, type Starter } from '../createStarters'
import CSearch from './CSearch.vue'
import {
  buildOf,
  fitOf,
  fmtGb,
  minutesLabel,
  playIn,
  recentWorkflows,
  starterFor,
  stopIn,
  useCreateKeys
} from './cLooks'

interface Try {
  id: string
  tab: string
  needsImage: boolean
  prompt: string
  ideas: string[]
  steps: number
  seconds: number
}

const TRIES: Try[] = [
  {
    id: 'image_z_image_turbo',
    tab: 'Text to image',
    needsImage: false,
    prompt: 'A woman with curly hair on a harbour at golden hour, film grain',
    ideas: [
      'A broccoli tree in a misty forest',
      'Neon noodle bar in the rain',
      'Paper boats on a lake'
    ],
    steps: 8,
    seconds: 6
  },
  {
    id: 'video_ltx2_3_i2v',
    tab: 'Image to video',
    needsImage: true,
    prompt: 'The bird lifts off and glides over the clouds',
    ideas: ['Slow push in', 'Wind in the grass', 'Waves roll in'],
    steps: 20,
    seconds: 48
  },
  {
    id: 'image_qwen_image_2_1_image_edit',
    tab: 'Edit an image',
    needsImage: true,
    prompt: 'Make the shirt dark green linen',
    ideas: [
      'Swap the background for a studio',
      'Turn it into a watercolour',
      'Add soft window light'
    ],
    steps: 12,
    seconds: 14
  }
]

type Phase = 'idle' | 'running' | 'done'

const query = ref('')
const field = ref<HTMLInputElement>()
const results = ref<InstanceType<typeof CSearch>>()
const tryId = ref(TRIES[0]!.id)
const prompt = ref('')
const dropped = ref<string>()
const dragging = ref(false)
const phase = ref<Phase>('idle')
const progress = ref(0)
const picker = ref<HTMLInputElement>()
useCreateKeys(field, false)

const current = computed(() => TRIES.find((t) => t.id === tryId.value)!)
const starter = computed<Starter>(() => starterFor(hubById(current.value.id)!, current.value.tab))
const fit = computed(() => fitOf(starter.value.template))
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const more = computed(() =>
  SHELVES[0]!
    .starters()
    .filter((s) => !TRIES.some((t) => t.id === s.id))
    .concat(SHELVES[3]!.starters().slice(1, 4))
    .slice(0, 6)
)
const recents = computed(() => recentWorkflows(4))

const step = computed(() =>
  Math.min(current.value.steps, Math.ceil(progress.value * current.value.steps))
)
const stage = computed(() => {
  if (progress.value < 0.12) return `Loading ${starter.value.model}`
  if (progress.value < 0.92) return `Step ${step.value} of ${current.value.steps}`
  return current.value.needsImage && starter.value.clip ? 'Encoding video' : 'Decoding'
})
const canGo = computed(() => !current.value.needsImage || Boolean(dropped.value))

const runsLine = computed(() => {
  const f = fit.value
  if (f.band === 'now')
    return `Runs free on ${activeInstance.value.name}, about ${current.value.seconds} s.`
  if (f.band === 'fetch' && f.gb)
    return `Downloads ${fmtGb(f.gb)} once (${minutesLabel(f.minutes)}), then runs free on this Mac.`
  if (f.cloudCost) return `Runs on Comfy Cloud for ${f.cloudCost}.`
  return f.local.note || f.local.status
})

let frame = 0
function stop(): void {
  cancelAnimationFrame(frame)
}
onBeforeUnmount(stop)

function generate(): void {
  if (!canGo.value || phase.value === 'running') return
  stop()
  phase.value = 'running'
  progress.value = 0
  const total = reduced ? 900 : 3600
  const start = performance.now()
  const tick = (now: number): void => {
    progress.value = Math.min(1, (now - start) / total)
    if (progress.value < 1) frame = requestAnimationFrame(tick)
    else phase.value = 'done'
  }
  frame = requestAnimationFrame(tick)
}

function reset(): void {
  stop()
  phase.value = 'idle'
  progress.value = 0
}

watch(tryId, () => {
  reset()
  prompt.value = ''
  dropped.value = undefined
})

function takeFile(file: File | undefined): void {
  if (!file || !file.type.startsWith('image/')) return
  if (dropped.value) URL.revokeObjectURL(dropped.value)
  dropped.value = URL.createObjectURL(file)
  reset()
}
function onDrop(e: DragEvent): void {
  dragging.value = false
  takeFile(e.dataTransfer?.files[0])
}
function onPick(e: Event): void {
  takeFile((e.target as HTMLInputElement).files?.[0])
}
function useSample(): void {
  dropped.value = starter.value.poster
  reset()
}

function onKey(e: KeyboardEvent): void {
  if (results.value?.onKey(e)) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeCreate()
  }
}
function onPromptKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    generate()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeCreate()
  }
}
</script>

<template>
  <section class="v12 relative min-h-full px-8 pb-20" aria-label="Create">
    <button type="button" class="v12-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="v12-wrap mx-auto flex w-full flex-col">
      <header class="v12-head">
        <div>
          <h1 class="text-display font-bold tracking-[-0.02em] text-base-foreground">
            Try it before you build it
          </h1>
          <p class="mt-1 text-body text-muted-foreground">
            Run a template right here. Like the result? Open it in ComfyUI and make it yours.
          </p>
        </div>
        <div class="v12-tools">
          <label class="v12-field">
            <Search :size="15" class="shrink-0 text-subtle-foreground" />
            <input
              ref="field"
              v-model="query"
              type="text"
              placeholder="Search workflows, templates and nodes"
              aria-label="Search workflows, templates and nodes"
              @keydown="onKey"
            />
            <button
              v-if="query"
              type="button"
              class="text-subtle-foreground"
              aria-label="Clear search"
              @click="((query = ''), field?.focus())"
            >
              <X :size="14" />
            </button>
          </label>
          <Button variant="ghost" size="lg" @click="startBlank"
            ><Plus :size="15" />Blank canvas</Button
          >
        </div>
      </header>

      <CSearch v-if="query.trim()" ref="results" :query class="mt-8" @clear="query = ''" />

      <template v-else>
        <div class="v12-stage">
          <div
            class="v12-output"
            :class="[`is-${phase}`, dragging && 'is-drag']"
            :style="{ '--p': progress }"
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop.prevent="onDrop"
          >
            <template v-if="phase === 'idle'">
              <img :src="starter.poster" alt="" class="v12-ghost" />
              <div class="v12-idle">
                <img v-if="dropped" :src="dropped" alt="Your image" class="v12-input" />
                <p class="text-heading font-medium text-base-foreground">
                  {{
                    dropped || !current.needsImage
                      ? 'Your result appears here'
                      : 'Drop an image here'
                  }}
                </p>
                <p class="mt-1 text-ui text-muted-foreground">
                  {{
                    current.needsImage && !dropped
                      ? 'Or pick one from your computer.'
                      : 'Press Generate to run it.'
                  }}
                </p>
                <div v-if="current.needsImage && !dropped" class="mt-4 flex gap-2">
                  <Button variant="secondary" @click="picker?.click()"
                    ><ImagePlus :size="14" />Choose image</Button
                  >
                  <Button variant="ghost" @click="useSample">Use the sample</Button>
                </div>
              </div>
            </template>
            <template v-else>
              <img :src="starter.poster" alt="Result" class="v12-result" />
              <video
                v-if="phase === 'done' && starter.clip"
                :src="starter.clip"
                :poster="starter.poster"
                class="v12-result"
                muted
                loop
                playsinline
                :autoplay="!reduced"
              />
              <span v-if="phase === 'running'" class="v12-noise" />
              <div v-if="phase === 'running'" class="v12-progress" role="status">
                <span class="text-ui text-white">{{ stage }}</span>
                <span class="text-ui text-white/70 tabular-nums"
                  >{{ Math.round(progress * 100) }}%</span
                >
                <span class="v12-bar"><span /></span>
              </div>
              <div v-else class="v12-done">
                <Button variant="primary" size="lg" @click="openTemplate(starter.template)"
                  >Open in ComfyUI to tweak</Button
                >
                <Button variant="overlay" size="lg" @click="generate"
                  ><RotateCcw :size="14" />Run again</Button
                >
              </div>
            </template>
            <input
              ref="picker"
              type="file"
              accept="image/*"
              class="hidden"
              tabindex="-1"
              @change="onPick"
            />
          </div>

          <aside class="v12-panel" aria-label="Try a template">
            <div class="v12-tabs" role="tablist" aria-label="Template to try">
              <button
                v-for="t in TRIES"
                :key="t.id"
                type="button"
                role="tab"
                :aria-selected="t.id === tryId"
                class="v12-tab"
                @click="tryId = t.id"
              >
                {{ t.tab }}
              </button>
            </div>
            <p class="mt-5 text-ui text-subtle-foreground">{{ starter.model }}</p>
            <p class="mt-1 text-ui text-muted-foreground">{{ starter.line }}.</p>

            <button
              v-if="current.needsImage"
              type="button"
              class="v12-drop"
              :class="dropped && 'has-image'"
              @click="picker?.click()"
            >
              <img v-if="dropped" :src="dropped" alt="" />
              <ImagePlus v-else :size="16" />
              <span>{{ dropped ? 'Image added · change' : 'Add an image' }}</span>
            </button>

            <label class="v12-prompt">
              <span class="sr-only">Prompt</span>
              <textarea
                v-model="prompt"
                rows="4"
                :placeholder="current.prompt"
                @keydown="onPromptKey"
              />
            </label>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <button
                v-for="idea in current.ideas"
                :key="idea"
                type="button"
                class="v12-idea"
                @click="prompt = idea"
              >
                {{ idea }}
              </button>
            </div>

            <Button
              variant="primary"
              size="lg"
              block
              class="mt-5"
              :disabled="!canGo || phase === 'running'"
              @click="generate"
            >
              <Sparkles :size="14" />{{ phase === 'running' ? 'Generating…' : 'Generate' }}
            </Button>
            <p class="mt-3 text-[12px] leading-[18px] text-subtle-foreground">{{ runsLine }}</p>
          </aside>
        </div>

        <section class="mt-12" aria-label="More templates">
          <h2 class="mb-3 text-ui text-subtle-foreground">Or start from one of these</h2>
          <div class="v12-more">
            <button
              v-for="s in more"
              :key="s.id"
              type="button"
              class="v12-card group"
              @pointerenter="playIn($event.currentTarget)"
              @pointerleave="stopIn($event.currentTarget)"
              @click="openTemplate(s.template)"
            >
              <span class="v12-card-pic">
                <img :src="s.poster" alt="" loading="lazy" />
                <video v-if="s.clip" :src="s.clip" muted loop playsinline preload="none" />
              </span>
              <span class="mt-2 block truncate text-ui font-medium text-base-foreground">{{
                s.makes
              }}</span>
              <span class="block truncate text-ui text-subtle-foreground">{{ s.model }}</span>
            </button>
          </div>
        </section>

        <section v-if="recents.length" class="mt-10" aria-label="Recent workflows">
          <h2 class="mb-3 text-ui text-subtle-foreground">Recent workflows</h2>
          <div class="v12-recents">
            <button
              v-for="w in recents"
              :key="w.id"
              type="button"
              class="v12-recent"
              @click="openWorkflow(w)"
            >
              <span class="v12-recent-cover"><WorkflowCover :name="w.name" /></span>
              <span class="flex min-w-0 flex-col text-left">
                <span class="truncate text-ui font-medium text-base-foreground">{{ w.name }}</span>
                <span class="truncate text-ui text-subtle-foreground"
                  >{{ buildOf(w)?.name }} · {{ w.modified }}</span
                >
              </span>
            </button>
          </div>
        </section>
      </template>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v12 {
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v12-wrap {
  max-width: 1200px;
}
:root .proto-ui.proto-ui.proto-ui .v12-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding-top: clamp(40px, 7vh, 72px);
}
:root .proto-ui.proto-ui.proto-ui .v12-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}
:root .proto-ui.proto-ui.proto-ui .v12-field {
  display: flex;
  height: 36px;
  width: 320px;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 12px;
  border-radius: var(--radius-control);
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v12-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v12-field input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v12-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 16px;
  margin-top: 28px;
}
:root .proto-ui.proto-ui.proto-ui .v12-output {
  position: relative;
  display: grid;
  min-height: 440px;
  place-items: center;
  overflow: hidden;
  border-radius: var(--radius-panel);
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v12-output.is-drag {
  box-shadow: inset 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v12-ghost {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.42;
  filter: saturate(0.7);
}
:root .proto-ui.proto-ui.proto-ui .v12-output.is-idle::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    closest-side,
    color-mix(in oklch, var(--color-card-background) 85%, transparent),
    color-mix(in oklch, var(--color-card-background) 30%, transparent)
  );
}
:root .proto-ui.proto-ui.proto-ui .v12-idle {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  text-align: center;
}
:root .proto-ui.proto-ui.proto-ui .v12-input {
  width: 120px;
  height: 120px;
  margin-bottom: 16px;
  border-radius: var(--radius-card);
  object-fit: cover;
  box-shadow: 0 18px 40px -20px oklch(0 0 0 / 0.8);
}
:root .proto-ui.proto-ui.proto-ui .v12-result {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v12-output.is-running .v12-result {
  filter: blur(calc((1 - var(--p)) * 28px)) saturate(calc(0.3 + var(--p) * 0.7));
  transform: scale(calc(1.08 - var(--p) * 0.08));
}
:root .proto-ui.proto-ui.proto-ui .v12-noise {
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  mix-blend-mode: overlay;
  opacity: calc(0.9 - var(--p) * 0.9);
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v12-progress {
  position: absolute;
  inset: auto 16px 16px;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--radius-card);
  background: var(--color-media-overlay);
  backdrop-filter: blur(14px);
}
:root .proto-ui.proto-ui.proto-ui .v12-bar {
  grid-column: 1 / -1;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.18);
}
:root .proto-ui.proto-ui.proto-ui .v12-bar > span {
  display: block;
  width: calc(var(--p) * 100%);
  height: 100%;
  background: white;
}
:root .proto-ui.proto-ui.proto-ui .v12-done {
  position: absolute;
  inset: auto 16px 16px;
  display: flex;
  gap: 8px;
  animation: v12-up 320ms var(--mar-ease, ease-out) both;
}
:root .proto-ui.proto-ui.proto-ui .v12-panel {
  display: flex;
  flex-direction: column;
  padding: 16px;
  border-radius: var(--radius-panel);
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v12-tabs {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v12-tab {
  flex: 1;
  height: 30px;
  border-radius: 7px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v12-tab[aria-selected='true'] {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-drop {
  display: flex;
  height: 52px;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  padding: 0 12px;
  border-radius: var(--radius-card);
  outline: 1px dashed var(--color-border-strong);
  outline-offset: -1px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v12-drop:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-drop.has-image {
  outline-style: solid;
  outline-color: var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v12-drop img {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v12-prompt textarea {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 12px;
  border: 0;
  border-radius: var(--radius-card);
  outline: none;
  resize: none;
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
  font: inherit;
  font-size: var(--text-ui);
  line-height: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v12-prompt textarea:focus {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v12-prompt textarea::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-idea {
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v12-idea:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-more {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v12-card {
  min-width: 0;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v12-card-pic {
  position: relative;
  display: block;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v12-card:focus-visible .v12-card-pic {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v12-card-pic img,
:root .proto-ui.proto-ui.proto-ui .v12-card-pic video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v12-card-pic video {
  opacity: 0;
  transition: opacity 240ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v12-card:hover .v12-card-pic video {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v12-recents {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v12-recent {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  padding: 6px;
  border-radius: var(--radius-card);
}
:root .proto-ui.proto-ui.proto-ui .v12-recent:hover {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v12-recent-cover {
  display: block;
  width: 64px;
  height: 44px;
  flex: none;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-card-background);
}
@keyframes v12-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@media (max-width: 1080px) {
  :root .proto-ui.proto-ui.proto-ui .v12-stage {
    grid-template-columns: minmax(0, 1fr);
  }
  :root .proto-ui.proto-ui.proto-ui .v12-more {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  :root .proto-ui.proto-ui.proto-ui .v12-recents {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v12-output.is-running .v12-result {
    filter: none;
    transform: none;
    opacity: var(--p);
  }
  :root .proto-ui.proto-ui.proto-ui .v12-noise {
    display: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v12-done {
    animation: none;
  }
}
</style>
