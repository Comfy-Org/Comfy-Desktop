<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowUp, ChevronDown, ImageUp, Images, Mic, Paperclip, X } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../ui/Button.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import { cn } from '../ui/cn'
import InstanceGlyph from './InstanceGlyph.vue'
import InstanceMenuItems from './InstanceMenuItems.vue'
import { runTask, startAgent } from '../agent'
import { thumb } from '../mock'
import { activeInstance, proto, requireLogin, toast } from '../useProto'

/** `chat`: inside the agent view - sends to the current chat instead of
 *  starting a new one, and shows a static placeholder. */
const { target = false, chat = false } = defineProps<{ target?: boolean; chat?: boolean }>()
const emit = defineEmits<{ send: [text: string] }>()

const text = defineModel<string>({ default: '' })
const textarea = ref<HTMLTextAreaElement>()
// Starter cards fill the box: prompt text plus the image it works on.
const attachment = ref<string>()
// The user's own images (local previews). They replace the card's example.
const uploads = ref<{ src: string; name: string }[]>([])
const fileInput = ref<HTMLInputElement>()
const dragging = ref(false)
function addFiles(files: FileList | null | undefined): void {
  for (const f of Array.from(files ?? []).filter((x) => x.type.startsWith('image/')))
    uploads.value.push({ src: URL.createObjectURL(f), name: f.name })
}
function removeUpload(i: number): void {
  URL.revokeObjectURL(uploads.value[i]!.src)
  uploads.value.splice(i, 1)
}
const intent = ref<'output' | 'workflow' | null>(null)
watch(
  () => proto.draft,
  (d) => {
    if (!d) return
    text.value = d.text
    attachment.value = d.thumbId
    intent.value = d.intent
    proto.draft = null
    nextTick(() => {
      textarea.value?.focus()
      textarea.value?.setSelectionRange(text.value.length, text.value.length)
    })
  }
)

function submit(): void {
  if (!text.value.trim()) return
  if (activeInstance.value.kind === 'cloud' && !proto.signedIn) {
    requireLogin('Log in to run this on Comfy Cloud')
    return
  }
  if (chat) {
    emit('send', text.value)
    text.value = ''
    uploads.value = []
    return
  }
  // The agent takes it from here, full screen.
  const image = uploads.value[0]?.src ?? attachment.value
  if (intent.value) runTask(text.value, intent.value, image)
  else startAgent(text.value)
  text.value = ''
  attachment.value = undefined
  uploads.value = []
  intent.value = null
}

// Typewriter placeholder cycling through example prompts, with a shimmer.
// Tab accepts the example on screen. Reduced motion: first example, static.
const EXAMPLES = [
  "Put this product in a model's hand",
  'Turn this photo into a 5 second video',
  'Remove the background and save as PNG',
  'Batch this workflow over a folder and save as WebP',
  'Upscale these renders to 4K'
]
const typed = ref('')
let ex = 0
let timer: ReturnType<typeof setTimeout> | undefined
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

function tick(deleting = false): void {
  const full = EXAMPLES[ex]!
  if (!deleting) {
    if (typed.value.length < full.length) {
      typed.value = full.slice(0, typed.value.length + 1)
      timer = setTimeout(tick, 38 + Math.random() * 40)
    } else timer = setTimeout(() => tick(true), 2200)
  } else if (typed.value.length) {
    typed.value = typed.value.slice(0, -1)
    timer = setTimeout(() => tick(true), 16)
  } else {
    ex = (ex + 1) % EXAMPLES.length
    timer = setTimeout(tick, 350)
  }
}
onMounted(() => {
  if (reduced) typed.value = EXAMPLES[0]!
  else timer = setTimeout(tick, 500)
})
onBeforeUnmount(() => clearTimeout(timer))

function accept(e: KeyboardEvent): void {
  if (text.value || !typed.value) return
  e.preventDefault()
  text.value = EXAMPLES[ex]!
}
</script>

<template>
  <!-- Panel 16, padding 10 -> inner controls 6. -->
  <div
    :class="['relative', dragging && 'ring-2 ring-border-focus']"
    class="mx-auto w-full max-w-180 edge-shine rounded-panel border bg-card-background py-2.5 pr-2.5 pl-3.5 shadow-elev transition-shadow duration-200 focus-within:shadow-elev-hover focus-within:[--shine:0.26]"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="((dragging = false), addFiles($event.dataTransfer?.files))"
  >
    <!-- Images: the card's example until you add your own -->
    <div v-if="intent === 'output' || uploads.length" class="mb-2 flex items-stretch gap-2 pt-1">
      <span v-for="(u, i) in uploads" :key="u.src" class="relative">
        <img :src="u.src" :alt="u.name" class="h-16 w-22 rounded-control object-cover" />
        <button
          type="button"
          :aria-label="`Remove ${u.name}`"
          class="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full border border-border-default bg-card-background text-muted-foreground hover:text-base-foreground"
          @click="removeUpload(i)"
        >
          <X :size="11" />
        </button>
      </span>
      <span v-if="attachment && !uploads.length" class="relative">
        <img
          :src="thumb(attachment)"
          alt="Example image"
          class="h-16 w-22 rounded-control object-cover opacity-70"
        />
        <span
          class="absolute bottom-1 left-1 rounded-min bg-media-overlay px-1.5 py-px text-[10px] text-white backdrop-blur-sm"
          >Example</span
        >
      </span>
      <button
        type="button"
        class="flex h-16 w-28 flex-col items-center justify-center gap-1 rounded-control border border-dashed border-border-strong text-ui text-muted-foreground outline-none hover:bg-secondary-background hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
        @click="fileInput?.click()"
      >
        <ImageUp :size="15" />{{ uploads.length ? 'Add more' : 'Upload yours' }}
      </button>
      <button
        type="button"
        class="flex h-16 w-28 flex-col items-center justify-center gap-1 rounded-control border border-border-default bg-secondary-background/40 text-ui text-muted-foreground outline-none hover:bg-secondary-background hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
        @click="toast('Pick from Assets')"
      >
        <Images :size="15" />From Assets
      </button>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="(e) => addFiles((e.target as HTMLInputElement).files)"
      />
    </div>
    <div class="relative pt-1">
      <textarea
        ref="textarea"
        v-model="text"
        :rows="chat ? 2 : 3"
        :aria-label="'Describe what to make, e.g. ' + EXAMPLES[0]"
        class="block w-full resize-none bg-transparent text-[14px] leading-normal text-base-foreground outline-none"
        @keydown.enter.exact.prevent="submit"
        @keydown.tab="accept"
      />
      <div
        v-if="!text"
        class="pointer-events-none absolute inset-0 pt-1 text-[14px] leading-normal"
        aria-hidden="true"
      >
        <span v-if="chat" class="text-subtle-foreground">Ask anything…</span>
        <template v-else
          ><span class="shimmer-text">{{ typed }}</span
          ><span class="caret"
        /></template>
      </div>
    </div>
    <div class="mt-1.5 flex items-center justify-between">
      <DropdownMenuRoot v-if="target" :modal="false">
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="border border-border-default pl-1.5 text-base-foreground"
          >
            <InstanceGlyph :inst="activeInstance" size="sm" />
            <span class="text-subtle-foreground">Run on</span>{{ activeInstance.name }}
            <span
              v-if="activeInstance.kind === 'cloud' && !proto.signedIn"
              class="text-ui text-subtle-foreground"
              >Log in</span
            >
            <ChevronDown :size="13" class="text-subtle-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-80">
          <InstanceMenuItems
            mode="select"
            label="Run on"
            @choose="(i) => (proto.activeInstanceId = i.id)"
          />
        </DropdownMenuContent>
      </DropdownMenuRoot>
      <Button v-else variant="ghost" size="icon-sm" aria-label="Attach"
        ><Paperclip :size="14"
      /></Button>
      <div class="flex items-center gap-1.5">
        <Button variant="ghost" size="icon-sm" aria-label="Dictate"><Mic :size="14" /></Button>
        <span class="h-4 w-px bg-border-strong" />
        <Button
          :variant="text.trim() ? 'primary' : 'subtle'"
          size="icon"
          aria-label="Send"
          :class="cn('rounded-full', !text.trim() && 'text-muted-foreground')"
          @click="submit"
        >
          <ArrowUp :size="15" />
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Shimmer: a light band sweeps across muted placeholder text. */
.shimmer-text {
  background: linear-gradient(
      100deg,
      var(--color-subtle-foreground) 40%,
      #d8d8dc 50%,
      var(--color-subtle-foreground) 60%
    )
    0 0 / 250% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: shimmer 2.6s linear infinite;
}
@keyframes shimmer {
  from {
    background-position: 125% 0;
  }
  to {
    background-position: -125% 0;
  }
}
.caret {
  display: inline-block;
  width: 1.5px;
  height: 1.1em;
  margin-left: 1px;
  vertical-align: -0.18em;
  background: var(--color-muted-foreground);
  animation: blink 1s steps(1) infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .shimmer-text {
    animation: none;
    background: none;
    color: var(--color-subtle-foreground);
  }
  .caret {
    display: none;
  }
}
</style>
