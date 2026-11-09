<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Check, ChevronLeft, Columns2, Download, ImageUp, Loader2 } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import { cn } from '../../ui/cn'
import { thumb } from '../../mock'
import { go, toast } from '../../useProto'
import { appsProto, usd, type Field } from '../../appFlow'
import { EXAMPLES } from '../userStates/examples'

/**
 * An app opens straight into its editor, as in the Hub's full-screen apps
 * (the shared editor kit, ComfyUI_frontend #20630, and Re-shoot and
 * Cinematic Studio on it, #20637 / #20638): a thin bar with Back, the
 * name and what it does; a floating panel with what you give it and Run
 * at its foot; and the stage, which shows the result, with Compare in a
 * dock under it. An example opens loaded: its picture in the panel, its
 * result on the stage, so you see what the app does before you run it.
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
// Mock variations of the one result.
const LOOKS = [
  'none',
  'contrast(1.12) saturate(1.15)',
  'sepia(0.3) saturate(1.3) hue-rotate(-12deg)',
  'brightness(1.08) saturate(0.85)'
]
const results = computed(() => LOOKS.slice(0, count.value))
const result = computed(() => sample.value ?? input.value)
/** The stage has a result to show: the example's, or yours. */
const shows = computed(() => state.value === 'done' || Boolean(sample.value))

// Compare: the before over the result, split where you drag.
const comparing = ref(false)
const split = ref(50)

function run(): void {
  if (state.value === 'running') return
  if (gate && !gate()) return
  comparing.value = false
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

function back(): void {
  appsProto.front = ''
  go('explore')
}
</script>

<template>
  <div class="mar-app-editor mar-app-page bg-app-background text-base-foreground">
    <!-- The thin bar: Back, the name and what it does; Download once there's a result -->
    <header class="flex h-12 shrink-0 items-center gap-2 px-3">
      <Button variant="ghost" size="icon-sm" aria-label="Back to Explore" @click="back"
        ><ChevronLeft :size="15"
      /></Button>
      <h1 class="shrink-0 text-ui font-medium">{{ name }}</h1>
      <p class="min-w-0 truncate text-ui text-subtle-foreground">{{ does }}</p>
      <span class="flex-1" />
      <Button v-if="state === 'done'" size="sm" @click="toast('Downloading…')"
        ><Download :size="12" />Download</Button
      >
      <slot name="account" />
    </header>

    <div class="mar-app-editor-body">
      <!-- Floating panel: what you give it, and Run -->
      <aside class="mar-app-editor-panel" aria-label="Input">
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
          <div v-for="f in shown" :key="f.id" class="flex flex-col gap-2">
            <span class="text-ui text-muted-foreground">{{ f.label }}</span>
            <button
              v-if="f.kind === 'image'"
              type="button"
              :class="
                cn(
                  'group relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-card outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                  f.id === firstImage
                    ? 'bg-secondary-background'
                    : 'border border-dashed border-border-strong text-muted-foreground hover:text-base-foreground'
                )
              "
              @click="toast('Pick an image')"
            >
              <template v-if="f.id === firstImage">
                <img :src="input" alt="" class="size-full object-cover" />
                <span
                  class="absolute right-2 bottom-2 inline-flex h-7 items-center gap-1.5 rounded-control bg-media-overlay px-2.5 text-ui backdrop-blur-sm"
                  ><ImageUp :size="13" />Replace</span
                >
              </template>
              <span v-else class="flex flex-col items-center gap-1.5 text-ui"
                ><ImageUp :size="16" />Add {{ f.label.toLowerCase() }}</span
              >
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
          </div>
          <slot name="place" />
        </div>
        <!-- Run stays at the panel's foot -->
        <div class="shrink-0 border-t border-border-default p-3">
          <Button variant="primary" size="lg" block :disabled="state === 'running'" @click="run">
            <Loader2 v-if="state === 'running'" :size="14" class="animate-spin" />
            {{ state === 'running' ? 'Running' : state === 'done' ? 'Run again' : 'Run' }}
            <span v-if="cost" class="font-normal opacity-60">· about {{ usd(cost * count) }}</span>
          </Button>
          <p class="mt-2 text-center text-ui text-subtle-foreground">{{ payer }}</p>
        </div>
      </aside>

      <!-- Stage: the result, the example's until you run it -->
      <main class="mar-app-editor-stage" aria-label="Output">
        <div class="relative flex min-h-0 flex-1 items-center justify-center p-6">
          <!-- Your result -->
          <div
            v-if="state === 'done'"
            :class="
              cn(
                'grid size-full gap-3',
                results.length > 1 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-1'
              )
            "
          >
            <div v-for="(filter, i) in results" :key="filter" class="relative min-h-0">
              <img
                :src="result"
                alt=""
                class="mar-app-editor-result absolute inset-0 size-full object-contain"
                :style="{ animationDelay: `${i * 80}ms`, filter }"
              />
            </div>
          </div>
          <!-- The example's result; Compare lays the before over it -->
          <div
            v-else-if="sample"
            :class="
              cn(
                'relative size-full transition-[opacity,filter] duration-500',
                state === 'running' && 'opacity-30 blur-md'
              )
            "
          >
            <img :src="sample" alt="" class="absolute inset-0 size-full object-contain" />
            <template v-if="comparing && state === 'idle'">
              <img
                :src="input"
                alt=""
                class="absolute inset-0 size-full object-contain"
                :style="{ clipPath: `inset(0 ${100 - split}% 0 0)` }"
              />
              <span
                class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-popover"
                :style="{ left: `${split}%` }"
              />
              <input
                v-model.number="split"
                type="range"
                min="0"
                max="100"
                aria-label="Before and after"
                class="mar-app-editor-split"
              />
            </template>
          </div>
          <span
            v-if="sample && state === 'idle'"
            class="pointer-events-none absolute top-3 left-3 flex gap-1.5"
          >
            <Badge v-if="comparing" variant="overlay" size="md">Before · After</Badge>
            <Badge v-else variant="overlay" size="md">Example</Badge>
          </span>
          <!-- Nothing yet -->
          <p v-else-if="state === 'idle'" class="flex flex-col items-center gap-1 px-6 text-center">
            <span class="text-heading font-medium">Your {{ made }} appears here</span>
            <span class="text-ui text-muted-foreground">Fill in the panel, then Run.</span>
          </p>

          <ul
            v-if="state === 'running'"
            class="absolute inset-0 flex flex-col items-center justify-center gap-1.5"
          >
            <li
              v-for="(s, i) in STEPS"
              :key="s"
              :class="
                cn(
                  'flex items-center gap-2 text-ui transition-opacity',
                  i < progress ? 'text-base-foreground' : 'text-subtle-foreground opacity-50'
                )
              "
            >
              <Check v-if="i < progress - 1" :size="13" class="text-status-running" />
              <Loader2 v-else-if="i === progress - 1" :size="13" class="animate-spin" />
              <span v-else class="size-[13px]" />{{ s }}
            </li>
          </ul>
        </div>

        <!-- Dock: Compare before a run; what you made, after it -->
        <div v-if="shows && state !== 'running'" class="mar-app-editor-dock">
          <template v-if="state === 'done'">
            <span class="px-2 text-ui text-subtle-foreground"
              >{{ results.length }} {{ results.length === 1 ? made : `${made}s` }} · 18 s ·
              {{ usd(cost * count) }}</span
            >
            <slot name="saved" />
          </template>
          <Button
            v-else
            variant="ghost"
            size="sm"
            :aria-pressed="comparing"
            :class="comparing && 'bg-secondary-background text-base-foreground'"
            @click="comparing = !comparing"
            ><Columns2 :size="13" />Compare</Button
          >
        </div>
      </main>
    </div>
    <slot name="below" />
  </div>
</template>

<style scoped>
.mar-app-editor {
  display: flex;
  height: 100%;
  min-height: 560px;
  flex-direction: column;
}
.mar-app-editor-body {
  display: flex;
  min-height: 0;
  flex: 1;
  gap: 12px;
  padding: 0 12px 12px;
}
.mar-app-editor-panel {
  display: flex;
  /* 280 like the Hub's panel; it gives way first on a narrow window. */
  width: clamp(232px, 30%, 280px);
  min-height: 0;
  flex-shrink: 0;
  flex-direction: column;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-panel);
  background: var(--color-card-background);
  box-shadow: var(--shadow-popover);
}
.mar-app-editor-stage {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-panel);
  background: color-mix(in oklch, var(--color-secondary-background) 40%, transparent);
}
.mar-app-editor-dock {
  display: flex;
  align-self: center;
  align-items: center;
  gap: 4px;
  margin-bottom: 14px;
  padding: 4px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-card);
  background: var(--color-card-background);
  box-shadow: var(--shadow-popover);
}
:root .proto-ui.proto-ui.proto-ui .mar-app-editor-text {
  width: 100%;
  resize: none;
  padding: 8px 10px;
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
.mar-app-editor-split {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: ew-resize;
  opacity: 0;
}
.mar-app-editor-result {
  animation: mar-app-editor-rise 500ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes mar-app-editor-rise {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-app-editor-result {
    animation: none;
  }
}
</style>
