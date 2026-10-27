<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  FolderOpen,
  ImageUp,
  Loader2,
  Plus,
  X
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import Button from '../../ui/Button.vue'
import Input from '../../ui/Input.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import { cn } from '../../ui/cn'
import { thumb } from '../../mock'
import { toast } from '../../useProto'
import { usd, type AppLayout, type Field } from '../../appFlow'

/**
 * The app as people use it: the inputs, one Run button, and - always under
 * it - who pays. The same panel on the app page, in the agent's preview
 * and at the app's URL.
 */
const {
  fields,
  thumbId,
  cost,
  payer,
  gate,
  compact = false,
  layout = 'left',
  runLabel = 'Run'
} = defineProps<{
  fields: Field[]
  thumbId: string
  cost: number
  /** The line under Run: who pays for this run. */
  payer: string
  /** Return false to stop the run (for example, to sign in first). */
  gate?: () => boolean
  compact?: boolean
  /** Inputs left, inputs right, or a prompt bar under the result. */
  layout?: AppLayout
  /** The Run button's words (the app's theme). */
  runLabel?: string
}>()
const emit = defineEmits<{ done: [] }>()

const shown = computed(() => fields.filter((f) => f.on))
// The prompt bar: the first text input is the big field; images are
// attachments; choices are pills.
const prompt = computed(() => shown.value.find((f) => f.kind === 'text'))
const images = computed(() => shown.value.filter((f) => f.kind === 'image'))
const pills = computed(() =>
  shown.value.filter(
    (f) => f.kind === 'choice' || f.kind === 'count' || (f.kind === 'text' && f !== prompt.value)
  )
)
const removed = reactive<Record<string, boolean>>({})
const values = reactive<Record<string, string>>({})
const pick = (f: Field): string => values[f.id] ?? f.options?.[0] ?? ''
const count = computed(() =>
  Number(pick(fields.find((f) => f.kind === 'count') ?? ({} as Field)) || 1)
)

const state = ref<'idle' | 'running' | 'done'>('idle')
const progress = ref(0)
const STEPS = ['Queued', 'Running on Comfy Cloud', 'Saving the result']
// Mock results: the example image, relit a few ways.
const LOOKS = [
  'contrast(1.12) saturate(1.15) brightness(1.04)',
  'sepia(0.35) saturate(1.35) hue-rotate(-12deg) brightness(1.05)',
  'contrast(1.3) brightness(0.95) saturate(0.9)',
  'brightness(1.1) saturate(0.8) hue-rotate(8deg)'
]
const results = computed(() =>
  LOOKS.slice(0, count.value).map((filter) => ({ src: thumbId, filter }))
)

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
</script>

<template>
  <div
    :class="
      cn(
        layout === 'bottom'
          ? 'flex flex-col items-center gap-6'
          : cn(
              'grid gap-6',
              layout === 'left'
                ? compact
                  ? 'grid-cols-[minmax(0,240px)_minmax(0,1fr)]'
                  : 'grid-cols-[minmax(0,320px)_minmax(0,1fr)]'
                : compact
                  ? 'grid-cols-[minmax(0,1fr)_minmax(0,240px)]'
                  : 'grid-cols-[minmax(0,1fr)_minmax(0,320px)]'
            )
      )
    "
  >
    <!-- Prompt bar: a chunky composer under the result, like an agent's -->
    <div v-if="layout === 'bottom'" class="order-2 flex w-full max-w-3xl flex-col gap-2">
      <div
        class="flex flex-col gap-3 rounded-panel border border-border-default bg-card-background p-3 transition-colors focus-within:border-border-strong"
      >
        <textarea
          v-if="prompt"
          :value="values[prompt.id] ?? ''"
          :placeholder="prompt.placeholder ?? prompt.label"
          rows="2"
          class="w-full resize-none bg-transparent px-1.5 pt-1 text-[15px] leading-6 outline-none placeholder:text-subtle-foreground"
          @input="values[prompt.id] = ($event.target as HTMLTextAreaElement).value"
        />
        <div class="flex flex-wrap items-center gap-2">
          <!-- Attachments -->
          <template v-for="f in images" :key="f.id">
            <span
              v-if="!removed[f.id]"
              class="group relative size-10 overflow-hidden rounded-control border border-border-default"
              :title="f.label"
            >
              <img :src="thumb(thumbId)" :alt="f.label" class="size-full object-cover" />
              <button
                type="button"
                :aria-label="`Remove ${f.label}`"
                class="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100"
                @click="removed[f.id] = true"
              >
                <X :size="13" />
              </button>
            </span>
          </template>
          <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon" aria-label="Add an image"
                ><Plus :size="15"
              /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-52">
              <DropdownMenuItem
                @select="
                  () => {
                    images.forEach((f) => (removed[f.id] = false))
                    toast('Pick an image')
                  }
                "
                ><ImageUp :size="14" />Upload an image</DropdownMenuItem
              >
              <DropdownMenuItem @select="toast('Opening your files')"
                ><FolderOpen :size="14" />From your files</DropdownMenuItem
              >
            </DropdownMenuContent>
          </DropdownMenuRoot>

          <!-- Choices as pills -->
          <DropdownMenuRoot v-for="f in pills" :key="f.id" :modal="false">
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="sm"
                class="h-8 rounded-full border border-border-default"
              >
                <span class="text-subtle-foreground">{{ f.label }}</span>
                {{ f.options ? pick(f) : values[f.id] || 'Any' }}
                <ChevronDown :size="12" class="text-subtle-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-44">
              <DropdownMenuItem v-for="o in f.options ?? []" :key="o" @select="values[f.id] = o"
                ><Check :size="13" :class="pick(f) === o ? '' : 'opacity-0'" />{{
                  o
                }}</DropdownMenuItem
              >
            </DropdownMenuContent>
          </DropdownMenuRoot>

          <Button
            variant="primary"
            class="ml-auto h-9 rounded-full pr-1.5 pl-4"
            :disabled="state === 'running'"
            @click="run"
          >
            {{ runLabel }} <span class="font-normal opacity-60">· {{ usd(cost * count) }}</span>
            <span
              class="inline-flex size-6 items-center justify-center rounded-full bg-inverted-foreground/10"
            >
              <Loader2 v-if="state === 'running'" :size="13" class="animate-spin" />
              <ArrowUp v-else :size="13" />
            </span>
          </Button>
        </div>
      </div>
      <p class="text-center text-ui text-subtle-foreground">{{ payer }}</p>
    </div>

    <!-- Side panel: inputs left or right -->
    <div v-else :class="cn('flex flex-col gap-5', layout === 'right' && 'order-2')">
      <TransitionGroup name="field" tag="div" class="flex flex-col gap-5">
        <div v-for="f in shown" :key="f.id" class="flex flex-col gap-2">
          <span class="text-ui text-muted-foreground">{{ f.label }}</span>
          <button
            v-if="f.kind === 'image'"
            type="button"
            class="group relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-card border border-border-default bg-secondary-background/40 outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            @click="toast('Pick an image')"
          >
            <img :src="thumb(thumbId)" alt="" class="size-full object-cover" />
            <span
              class="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/55 text-ui opacity-0 transition-opacity group-hover:opacity-100"
              ><ImageUp :size="14" />Replace</span
            >
          </button>
          <Input
            v-else-if="f.kind === 'text'"
            :model-value="values[f.id] ?? ''"
            :placeholder="f.placeholder ?? ''"
            @update:model-value="(v: string) => (values[f.id] = v)"
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
      </TransitionGroup>

      <div class="flex flex-col gap-2 pt-1">
        <Button variant="primary" size="lg" block :disabled="state === 'running'" @click="run">
          <Loader2 v-if="state === 'running'" :size="14" class="animate-spin" />
          {{ state === 'running' ? 'Running' : runLabel }}
          <span class="font-normal opacity-60">· about {{ usd(cost * count) }}</span>
        </Button>
        <p class="text-center text-ui text-subtle-foreground">{{ payer }}</p>
      </div>
    </div>

    <!-- Result -->
    <div
      :class="cn('flex min-w-0 flex-col gap-3', layout === 'bottom' && 'order-1 w-full max-w-2xl')"
    >
      <div
        :class="
          cn(
            'relative grid min-h-0 gap-2 overflow-hidden rounded-card border border-border-default',
            results.length > 1 && state === 'done' ? 'grid-cols-2' : 'grid-cols-1'
          )
        "
      >
        <template v-if="state === 'done'">
          <img
            v-for="(r, i) in results"
            :key="r.filter"
            :src="thumb(r.src)"
            alt=""
            class="result aspect-[4/3] size-full object-cover"
            :style="{ animationDelay: `${i * 80}ms`, filter: r.filter }"
          />
        </template>
        <div v-else class="relative aspect-[4/3]">
          <img
            :src="thumb(thumbId)"
            alt=""
            :class="
              cn(
                'size-full object-cover transition-[opacity,filter] duration-500',
                state === 'running' ? 'opacity-25 blur-md' : 'opacity-35'
              )
            "
          />
          <span
            v-if="state === 'idle'"
            class="absolute top-3 left-3 rounded-min bg-media-overlay px-2 py-0.5 text-ui text-muted-foreground backdrop-blur-sm"
            >Example</span
          >
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
      <div v-if="state === 'done'" class="flex items-center gap-2">
        <span class="flex-1 text-ui text-subtle-foreground"
          >{{ results.length }} {{ results.length === 1 ? 'image' : 'images' }} · 18 s ·
          {{ usd(cost * count) }}</span
        >
        <Button size="sm" variant="ghost" @click="state = 'idle'">Run again</Button>
        <Button size="sm" @click="toast('Downloading…')"><Download :size="12" />Download</Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.field-enter-active {
  transition:
    opacity 400ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 400ms cubic-bezier(0.16, 1, 0.3, 1);
}
.field-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.result {
  animation: rise 500ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .field-enter-active,
  .result {
    transition: none;
    animation: none;
  }
}
</style>
