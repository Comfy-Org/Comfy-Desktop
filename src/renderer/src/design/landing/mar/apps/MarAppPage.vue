<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ArrowRight, Check, ChevronRight, Download, ImageUp, Loader2 } from 'lucide-vue-next'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import MemberAvatar from '../../parts/MemberAvatar.vue'
import { cn } from '../../ui/cn'
import { thumb } from '../../mock'
import { go, toast } from '../../useProto'
import { appsProto, usd, type Field } from '../../appFlow'
import { EXAMPLES, runExample } from '../userStates/examples'

/**
 * An app's page, laid out like the app pages of the Hub redesign: where it
 * sits (Explore › Apps), its name and what it does, then two cards side by
 * side - Input (what you give it, with Run at its foot) and Output (an
 * example result until you run it, then yours) - and more apps under them.
 * Home's examples bring their own pictures: what goes in fills the input,
 * what comes out fills the output, so the page shows what the app does
 * before anyone presses Run.
 */
const {
  appId,
  name,
  blurb,
  author,
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
  author: string
  thumbId: string
  fields: Field[]
  cost: number
  payer: string
  gate?: () => boolean
  output?: string
}>()
const emit = defineEmits<{ done: [] }>()
// The themed page's props (layout, theme) come along; they don't apply here.
defineOptions({ inheritAttrs: false })

const example = computed(() => EXAMPLES.find((x) => x.app === appId))
const does = computed(() => example.value?.does ?? blurb)
const kind = computed(() => example.value?.kind ?? (output === 'video' ? 'Video' : 'Image'))
const made = computed(() => kind.value.toLowerCase())
/** What goes in: the example's own picture, or the app's cover. */
const input = computed(() => example.value?.src ?? thumb(thumbId))
/** What comes out: only an example has one to show before a run. */
const sample = computed(() => example.value?.after)
const more = computed(() => EXAMPLES.filter((x) => x.app !== appId).slice(0, 4))

// An example always starts from its picture, so what goes in sits next to
// what comes out; an app whose inputs are words alone gets it as the first.
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

function run(): void {
  if (state.value === 'running') return
  if (gate && !gate()) return
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

function toExplore(): void {
  appsProto.front = ''
  go('explore')
}
</script>

<template>
  <div class="mar-app-hub mar-app-page min-h-full bg-app-background text-base-foreground">
    <div class="mar-app-hub-body mx-auto flex w-full max-w-6xl flex-col pt-5 pb-10">
      <header class="flex items-center justify-between gap-4">
        <nav aria-label="Breadcrumb" class="mar-app-hub-crumbs">
          <button type="button" @click="toExplore">Explore</button>
          <ChevronRight :size="13" aria-hidden="true" />
          <button type="button" @click="toExplore">Apps</button>
          <ChevronRight :size="13" aria-hidden="true" />
          <span aria-current="page" class="truncate text-base-foreground">{{ name }}</span>
        </nav>
        <slot name="account" />
      </header>

      <!-- What it is and what it does -->
      <section class="mt-8">
        <h1 class="mar-app-hub-title">{{ name }}</h1>
        <p class="mt-2 text-heading font-normal text-muted-foreground">{{ does }}</p>
        <p class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-ui text-subtle-foreground">
          <Badge variant="outline" size="md">App</Badge>
          <span>{{ kind }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ example?.runs ?? '~20 s' }} a run</span>
          <span aria-hidden="true">·</span>
          <span class="flex items-center gap-1.5"
            ><MemberAvatar :name="author" size="sm" />by {{ author }}</span
          >
        </p>
      </section>

      <div class="mar-app-hub-grid mt-8">
        <!-- Input: what you give it, and Run -->
        <section class="mar-app-hub-card" aria-labelledby="app-input">
          <h2 id="app-input" class="mar-app-hub-cardhead">Input</h2>
          <div class="flex flex-col gap-5 p-4">
            <div v-for="f in shown" :key="f.id" class="flex flex-col gap-2">
              <span class="text-ui font-medium">{{ f.label }}</span>
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
                  <Badge variant="overlay" size="md" class="absolute top-2.5 left-2.5"
                    >Example</Badge
                  >
                  <span
                    class="absolute right-2.5 bottom-2.5 inline-flex h-7 items-center gap-1.5 rounded-control bg-media-overlay px-2.5 text-ui backdrop-blur-sm"
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
                class="mar-app-hub-text"
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
          <div class="mar-app-hub-run">
            <Button variant="primary" size="lg" block :disabled="state === 'running'" @click="run">
              <Loader2 v-if="state === 'running'" :size="14" class="animate-spin" />
              {{ state === 'running' ? 'Running' : 'Run' }}
              <span v-if="cost" class="font-normal opacity-60"
                >· about {{ usd(cost * count) }}</span
              >
            </Button>
            <p class="mt-2 text-center text-ui text-subtle-foreground">{{ payer }}</p>
          </div>
        </section>

        <!-- Output: an example until you run it, then yours -->
        <section class="mar-app-hub-card" aria-labelledby="app-output">
          <div class="mar-app-hub-cardhead flex items-center justify-between">
            <h2 id="app-output">Output</h2>
            <span v-if="state === 'done'" class="font-normal text-subtle-foreground">Just now</span>
          </div>
          <div class="p-4">
            <div
              :class="
                cn(
                  'relative grid gap-2 overflow-hidden rounded-card bg-secondary-background',
                  state === 'done' && results.length > 1 ? 'grid-cols-2' : 'grid-cols-1'
                )
              "
            >
              <template v-if="state === 'done'">
                <img
                  v-for="(filter, i) in results"
                  :key="filter"
                  :src="result"
                  alt=""
                  class="mar-app-hub-result aspect-[4/3] size-full object-cover"
                  :style="{ animationDelay: `${i * 80}ms`, filter }"
                />
              </template>
              <div v-else class="relative aspect-[4/3]">
                <img
                  v-if="sample"
                  :src="sample"
                  alt=""
                  :class="
                    cn(
                      'size-full object-cover transition-[opacity,filter] duration-500',
                      state === 'running' && 'opacity-25 blur-md'
                    )
                  "
                />
                <Badge
                  v-if="sample && state === 'idle'"
                  variant="overlay"
                  size="md"
                  class="absolute top-2.5 left-2.5"
                  >Example</Badge
                >
                <p
                  v-if="!sample && state === 'idle'"
                  class="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center"
                >
                  <span class="text-heading font-medium">Your result appears here</span>
                  <span class="text-ui text-muted-foreground">Fill in the input, then Run.</span>
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
            </div>
            <div v-if="state === 'done'" class="mt-3 flex flex-wrap items-center gap-2">
              <span class="flex-1 text-ui text-subtle-foreground"
                >{{ results.length }} {{ results.length === 1 ? made : `${made}s` }} · 18 s ·
                {{ usd(cost * count) }}</span
              >
              <slot name="saved" />
              <Button size="sm" variant="ghost" @click="state = 'idle'">Run again</Button>
              <Button size="sm" @click="toast('Downloading…')"
                ><Download :size="12" />Download</Button
              >
            </div>
          </div>
        </section>
      </div>
      <slot name="below" />

      <!-- More like this -->
      <section v-if="more.length" class="mt-14" aria-labelledby="app-more">
        <div class="flex items-center justify-between">
          <h2 id="app-more" class="text-heading font-medium">More apps</h2>
          <Button variant="link" size="sm" @click="toExplore"
            >See all apps<ArrowRight :size="13"
          /></Button>
        </div>
        <ul class="mar-app-hub-more-grid mt-4">
          <li v-for="x in more" :key="x.app">
            <button type="button" class="mar-app-hub-more group" @click="runExample(x)">
              <span class="block aspect-[4/3] overflow-hidden rounded-card bg-secondary-background"
                ><img
                  :src="x.after"
                  alt=""
                  class="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              /></span>
              <span class="mt-2.5 block truncate text-ui font-medium">{{ x.label }}</span>
              <span class="block truncate text-ui text-muted-foreground">{{ x.does }}</span>
              <span class="mt-0.5 block text-ui text-subtle-foreground"
                >App · {{ x.kind }} · {{ x.runs }}</span
              >
            </button>
          </li>
        </ul>
      </section>

      <footer
        class="mt-14 flex items-center border-t border-border-default pt-5 text-ui text-subtle-foreground"
      >
        <span class="flex items-center gap-1.5"><ComfyCLogo :size="12" />Made with Comfy</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.mar-app-hub-crumbs {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
  font-size: var(--text-ui);
  line-height: var(--text-ui--line-height);
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-app-hub-crumbs button {
  height: 26px;
  padding: 0 6px;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-app-hub-crumbs button:first-child {
  margin-left: -6px;
}
:root .proto-ui.proto-ui.proto-ui .mar-app-hub-crumbs button:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
.mar-app-hub-crumbs > span {
  padding: 0 6px;
}
.mar-app-hub-title {
  font-size: var(--text-display);
  line-height: var(--text-display--line-height);
  font-weight: 600;
  letter-spacing: -0.02em;
}
.mar-app-hub {
  container-type: inline-size;
}
.mar-app-hub-body {
  padding-inline: 40px;
}
.mar-app-hub-grid {
  display: grid;
  grid-template-columns: minmax(0, 360px) minmax(0, 1fr);
  align-items: start;
  gap: 24px;
}
.mar-app-hub-more-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
/* A narrow window: input and output stay side by side, in halves, so what
   goes in still sits next to what comes out; only a very narrow one stacks. */
@container (max-width: 860px) {
  .mar-app-hub-body {
    padding-inline: 28px;
  }
  .mar-app-hub-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .mar-app-hub-more-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@container (max-width: 520px) {
  .mar-app-hub-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.mar-app-hub-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-panel);
  background: var(--color-card-background);
}
.mar-app-hub-cardhead {
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border-default);
  font-size: var(--text-ui);
  line-height: var(--text-ui--line-height);
  font-weight: 500;
  color: var(--color-muted-foreground);
}
/* Run stays in reach while the inputs scroll, like the Hub's. */
.mar-app-hub-run {
  position: sticky;
  bottom: 0;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--color-border-default);
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .mar-app-hub-text {
  width: 100%;
  resize: none;
  padding: 8px 10px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
  background: transparent;
  font-size: var(--text-ui);
  line-height: var(--text-ui--line-height);
  outline: none;
  transition: border-color 150ms;
}
:root .proto-ui.proto-ui.proto-ui .mar-app-hub-text:focus {
  border-color: var(--color-border-strong);
}
.mar-app-hub-text::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-app-hub-more {
  display: block;
  width: 100%;
  border-radius: var(--radius-card);
  text-align: left;
  outline: none;
}
.mar-app-hub-more:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mar-app-hub-result {
  animation: mar-app-hub-rise 500ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes mar-app-hub-rise {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-app-hub-result {
    animation: none;
  }
}
</style>
