<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, ExternalLink, RotateCw } from 'lucide-vue-next'
import { hostActions, instanceById, instances, toast } from '../../useProto'
import portraitSun from '../assets/portrait-sun.jpg'
import portraitSeaside from '../assets/portrait-seaside.jpg'
import lakeFog from '../assets/lake-fog.jpg'
import hillsFog from '../assets/hills-fog.jpg'
import portraitSmile from '../assets/portrait-smile.jpg'
import portraitGrass from '../assets/portrait-grass.jpg'

/**
 * 14 · Inspector (Figma 119:2638): the latest output, or the one picked in
 * the strip, with the prompt, model and settings that made it. Run again
 * queues the same settings; Open in ComfyUI loads its workflow in the
 * build it ran on.
 */
interface Output {
  id: string
  name: string
  src: string
  project: string
  when: string
  envId: string
  size: string
  prompt: string
  model: string
  seed: number
  steps: number
  cfg: number
  sampler: string
  time: string
}

const OUTPUTS: Output[] = [
  {
    id: 'product-relight',
    name: 'product-relight',
    src: portraitSun,
    project: 'Product Shots',
    when: 'Yesterday',
    envId: 'local-1',
    size: '1024 × 1280',
    prompt: 'A model holding the product at eye level, soft window light, warm film tones',
    model: 'Flux.1 dev',
    seed: 11902,
    steps: 28,
    cfg: 3.5,
    sampler: 'euler · simple',
    time: '1 min 12 s'
  },
  {
    id: 'hero-shot-v4',
    name: 'hero-shot-v4',
    src: portraitSeaside,
    project: 'Hero shots',
    when: '12 min ago',
    envId: 'local-1',
    size: '1216 × 832',
    prompt: 'Portrait by the sea at golden hour, wind in the hair, linen shirt, 35 mm',
    model: 'Flux.1 dev',
    seed: 48211,
    steps: 30,
    cfg: 3.0,
    sampler: 'dpmpp_2m · karras',
    time: '1 min 31 s'
  },
  {
    id: 'rice-terraces-i2v',
    name: 'rice-terraces-i2v',
    src: lakeFog,
    project: 'Video Lab',
    when: '1 hour ago',
    envId: 'local-video',
    size: '1280 × 720 · 5 s',
    prompt: 'Slow push in over a misty lake at dawn, birds crossing, gentle ripples',
    model: 'Wan 2.2 i2v',
    seed: 7731,
    steps: 24,
    cfg: 5.0,
    sampler: 'uni_pc · simple',
    time: '4 min 08 s'
  },
  {
    id: 'angles-sheet',
    name: 'angles-sheet',
    src: hillsFog,
    project: 'My Local 1',
    when: '2 days ago',
    envId: 'local-1',
    size: '1536 × 1024',
    prompt: 'Rolling hills in fog, late autumn, aerial view, soft contrast',
    model: 'SDXL 1.0',
    seed: 90210,
    steps: 32,
    cfg: 6.0,
    sampler: 'euler_a · normal',
    time: '0 min 52 s'
  },
  {
    id: 'banana-edit-batch',
    name: 'banana-edit-batch',
    src: portraitSmile,
    project: 'Product Shots',
    when: '2 days ago',
    envId: 'local-1',
    size: '1024 × 1024',
    prompt: 'Same person, warmer smile, background softened, keep the hair and lighting',
    model: 'Qwen Image Edit',
    seed: 30419,
    steps: 20,
    cfg: 2.5,
    sampler: 'euler · simple',
    time: '0 min 47 s'
  },
  {
    id: 'flux-portraits',
    name: 'flux-portraits',
    src: portraitGrass,
    project: 'Flux tests',
    when: 'Last week',
    envId: 'local-flux',
    size: '896 × 1152',
    prompt: 'Portrait in tall grass, backlit, hazy summer afternoon, shallow depth of field',
    model: 'Flux.1 schnell',
    seed: 551,
    steps: 4,
    cfg: 1.0,
    sampler: 'euler · simple',
    time: '0 min 38 s'
  }
]

const pickedId = ref(OUTPUTS[0]!.id)
const out = computed(() => OUTPUTS.find((o) => o.id === pickedId.value) ?? OUTPUTS[0]!)
const env = computed(
  () => instanceById(out.value.envId) ?? instances.value.find((i) => i.kind === 'local')
)
const rows = computed(() => [
  { label: 'Model', value: out.value.model },
  { label: 'Seed', value: String(out.value.seed) },
  { label: 'Steps', value: String(out.value.steps) },
  { label: 'CFG', value: out.value.cfg.toFixed(1).replace(/\.0$/, '') },
  { label: 'Sampler', value: out.value.sampler },
  { label: 'Time', value: out.value.time }
])

function runAgain(): void {
  toast(`Queued ${out.value.name} on ${env.value?.name ?? 'your build'}`)
}
function openInComfy(): void {
  if (env.value) hostActions.launch(env.value, `${out.value.name}.json`)
}
async function copyPrompt(): Promise<void> {
  try {
    await navigator.clipboard.writeText(out.value.prompt)
    toast('Prompt copied')
  } catch {
    toast('Could not copy the prompt')
  }
}
</script>

<template>
  <aside class="p14-inspector" aria-label="Inspector">
    <div class="p14-scroll">
      <figure class="p14-media">
        <img :src="out.src" :alt="out.name" />
        <span class="p14-size">{{ out.size }}</span>
      </figure>

      <div class="p14-title">
        <h2>{{ out.name }}</h2>
        <p>{{ out.project }} · {{ out.when }} · {{ env?.name ?? 'My Local 1' }}</p>
      </div>

      <div class="p14-prompt">
        <div class="p14-prompt-head">
          <span>Prompt</span>
          <button type="button" class="p14-copy" title="Copy prompt" @click="copyPrompt">
            <Copy :size="12" />
          </button>
        </div>
        <p>{{ out.prompt }}</p>
      </div>

      <dl class="p14-rows">
        <div v-for="r in rows" :key="r.label" class="p14-row">
          <dt>{{ r.label }}</dt>
          <dd>{{ r.value }}</dd>
        </div>
      </dl>

      <div class="p14-strip-wrap">
        <p class="p14-label">Latest outputs</p>
        <div class="p14-strip" role="listbox" aria-label="Latest outputs">
          <button
            v-for="o in OUTPUTS"
            :key="o.id"
            type="button"
            role="option"
            class="p14-pick"
            :class="o.id === out.id && 'is-on'"
            :aria-selected="o.id === out.id"
            :title="o.name"
            @click="pickedId = o.id"
          >
            <img :src="o.src" alt="" />
          </button>
        </div>
      </div>
    </div>

    <footer class="p14-foot">
      <button type="button" class="p14-primary" @click="runAgain">
        <RotateCw :size="13" />Run again
      </button>
      <button type="button" class="p14-secondary" @click="openInComfy">
        Open in ComfyUI<ExternalLink :size="12" />
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.p14-inspector {
  position: fixed;
  top: var(--mar-chrome, 0px);
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  width: 376px;
  flex-direction: column;
  background: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  backdrop-filter: blur(32px) saturate(1.2);
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  -webkit-app-region: no-drag;
}
.p14-scroll {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow-y: auto;
  padding: 18px 18px 8px;
  scrollbar-width: none;
}
.p14-media {
  position: relative;
  aspect-ratio: 340 / 300;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.p14-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.p14-size {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--color-media-overlay);
  backdrop-filter: blur(12px);
  color: oklch(0.96 0 0);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.p14-title {
  padding: 16px 0 14px;
}
.p14-title h2 {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.p14-title p {
  margin-top: 2px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.p14-prompt {
  padding: 10px 12px 12px;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.p14-prompt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--color-subtle-foreground);
  font-size: 11.5px;
}
.p14-prompt p {
  margin-top: 4px;
  line-height: 1.45;
  text-wrap: pretty;
}
.p14-rows {
  display: flex;
  flex-direction: column;
  padding: 16px 0 4px;
}
.p14-row {
  display: flex;
  height: 28px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
}
.p14-row dt {
  color: var(--color-subtle-foreground);
}
.p14-row dd {
  overflow: hidden;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.p14-strip-wrap {
  margin-top: auto;
  padding-top: 16px;
}
.p14-label {
  padding-bottom: 8px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.p14-strip {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
}
.p14-foot {
  display: flex;
  gap: 8px;
  padding: 12px 18px 18px;
}
</style>

<style>
/* Pablo's reset wipes padding and width on buttons inside .proto-ui. */
:root .proto-ui.proto-ui.proto-ui .p14-pick {
  aspect-ratio: 1;
  width: 100%;
  padding: 0;
  overflow: hidden;
  border-radius: 8px;
  opacity: 0.55;
  transition: opacity 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p14-pick img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .p14-pick:hover {
  opacity: 0.85;
}
:root .proto-ui.proto-ui.proto-ui .p14-pick.is-on {
  opacity: 1;
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 3.5px var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .p14-copy {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 6px;
  color: var(--color-subtle-foreground);
  transition:
    background-color 150ms ease,
    color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p14-copy:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui :is(.p14-primary, .p14-secondary) {
  display: inline-flex;
  height: 34px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: 10px;
  font-size: var(--text-ui);
  font-weight: 500;
  transition: background-color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p14-primary {
  flex: 1;
  width: auto;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .p14-primary:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .p14-secondary {
  width: auto;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .p14-secondary:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
:root
  .proto-ui.proto-ui.proto-ui
  :is(.p14-primary, .p14-secondary, .p14-pick, .p14-copy):focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

/* The page leaves room for the panel on the right. */
:root[data-mar-ui='on'][data-mar-panel='inspector'] .proto-main.proto-main {
  padding-right: 376px;
}
</style>
