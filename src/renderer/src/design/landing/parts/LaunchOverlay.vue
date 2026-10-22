<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { AppWindow, Check } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../ui/Button.vue'
import DialogContent from '../ui/DialogContent.vue'
import { cn } from '../ui/cn'
import InstanceGlyph from './InstanceGlyph.vue'
import { instanceById, proto } from '../useProto'

/** Mock launch sequence. Makes the launcher model visible: ComfyUI starts
 *  from the chosen instance, then opens in its own window. */
const open = computed({
  get: () => Boolean(proto.launching),
  set: (v) => {
    if (!v) proto.launching = null
  }
})
const inst = computed(() =>
  proto.launching ? instanceById(proto.launching.instanceId) : undefined
)

const steps = computed<string[]>(() => {
  const i = inst.value
  if (!i) return []
  const what = proto.launching?.what ? `Opening ${proto.launching.what}` : 'Opening a blank canvas'
  if (i.kind === 'cloud') return ['Connecting to Comfy Cloud', 'Reserving a GPU', what]
  if (i.state === 'running') return [`${i.name} is already running`, what]
  return [
    'Starting the Python environment',
    `Loading ${i.nodes ?? 0} custom node packs`,
    'Starting ComfyUI on localhost:8188',
    what
  ]
})

const done = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
watch(
  () => proto.launching,
  (l) => {
    clearInterval(timer)
    done.value = 0
    if (!l) return
    timer = setInterval(() => {
      done.value += 1
      if (done.value >= steps.value.length) clearInterval(timer)
    }, 650)
  },
  { immediate: true }
)
onBeforeUnmount(() => clearInterval(timer))
const finished = computed(() => done.value >= steps.value.length)
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent v-if="inst" :closable="false" class="p-5">
      <div class="flex items-center gap-3.5">
        <span :class="cn('relative inline-flex', !finished && 'launch-ring')"
          ><InstanceGlyph :inst size="xl"
        /></span>
        <div>
          <DialogTitle class="text-heading font-semibold">{{
            finished ? 'ComfyUI is open' : 'Launching ComfyUI'
          }}</DialogTitle>
          <p class="mt-0.5 text-ui text-subtle-foreground">
            from {{ inst.name
            }}<template v-if="inst.version"> · {{ inst.channel }} {{ inst.version }}</template>
          </p>
        </div>
      </div>

      <ol class="my-4.5 flex flex-col gap-2 text-subtle-foreground">
        <li
          v-for="(s, i) in steps"
          :key="s"
          :class="
            cn(
              'flex items-center gap-2.5 transition-colors duration-200',
              i <= done && 'text-base-foreground'
            )
          "
        >
          <span
            :class="
              cn(
                'inline-flex size-4 items-center justify-center rounded-full border border-border-strong',
                i < done &&
                  'border-inverted-background bg-inverted-background text-inverted-foreground',
                i === done && 'animate-spin border-base-foreground/70 border-r-transparent'
              )
            "
          >
            <Check v-if="i < done" :size="11" />
          </span>
          {{ s }}
        </li>
      </ol>

      <div class="h-0.75 overflow-hidden rounded-full bg-secondary-background">
        <div
          class="h-full rounded-full bg-inverted-background transition-[width] duration-500 ease-out-expo"
          :style="{ width: `${(done / steps.length) * 100}%` }"
        />
      </div>

      <DialogDescription class="mt-3.5 flex gap-2 text-ui leading-normal text-muted-foreground">
        <AppWindow :size="14" class="mt-0.5 shrink-0" />
        {{
          finished
            ? 'It opened in its own window. This launcher stays here, so you can start another build anytime.'
            : "ComfyUI opens in its own window when it's ready."
        }}
      </DialogDescription>

      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" @click="open = false">{{
          finished ? 'Stay here' : 'Run in background'
        }}</Button>
        <Button variant="primary" :disabled="!finished" @click="open = false">Go to window</Button>
      </div>
    </DialogContent>
  </DialogRoot>
</template>

<style scoped>
.launch-ring::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 32%;
  border: 1.5px solid transparent;
  border-top-color: rgb(255 255 255 / 0.7);
  animation: spin 900ms linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
