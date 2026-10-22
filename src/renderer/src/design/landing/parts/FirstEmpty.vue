<script setup lang="ts">
import { computed } from 'vue'
import {
  AppWindow,
  Images,
  Rocket,
  Sparkles,
  Upload,
  Waypoints,
  type LucideIcon
} from 'lucide-vue-next'
import Button from '../ui/Button.vue'
import { activeInstance, go, hostActions, proto, toast } from '../useProto'

/**
 * First-run empty state for a library: a small fanned stack of ghost
 * cards (what will live here), one line of copy, and a way to fill it.
 */
const { kind } = defineProps<{ kind: 'workflows' | 'apps' | 'assets' }>()

const COPY: Record<
  typeof kind,
  { title: string; body: string; icon: LucideIcon; alt: string; altIcon: LucideIcon }
> = {
  workflows: {
    title: 'No workflows yet',
    body: 'Describe what you want and the agent wires up the nodes.',
    icon: Waypoints,
    alt: 'Import a .json',
    altIcon: Upload
  },
  apps: {
    title: 'Your apps will live here',
    body: 'Turn any workflow into a simple form anyone can use.',
    icon: AppWindow,
    alt: 'Browse templates',
    altIcon: AppWindow
  },
  assets: {
    title: 'Nothing generated yet',
    body: 'Every image, video and model you make shows up here.',
    icon: Images,
    alt: 'Upload files',
    altIcon: Upload
  }
}
const c = computed(() => COPY[kind])
function ask(): void {
  proto.mode = 'agent'
  go('agent')
}
function alt(): void {
  if (kind === 'apps') go('explore')
  else toast(kind === 'workflows' ? 'Pick a workflow .json' : 'Pick files to upload')
}
</script>

<template>
  <div class="flex min-h-[70vh] flex-col items-center justify-center text-center">
    <!-- Ghost cards, fanned; the front one carries the icon -->
    <div class="hand relative mb-9 h-28 w-40" aria-hidden="true">
      <span
        v-for="n in [-1, 1]"
        :key="n"
        class="ghost absolute inset-0 rounded-card border border-border-default bg-card-background/60"
        :style="{ '--r': `${n * 9}deg`, '--x': `${n * 22}px` }"
      />
      <span
        class="front absolute inset-0 flex items-center justify-center rounded-card border border-border-strong bg-card-background shadow-[0_18px_40px_-18px_rgb(0_0_0/0.9)]"
      >
        <component :is="c.icon" :size="26" class="text-muted-foreground" />
        <span
          class="absolute right-2.5 bottom-2.5 h-1.5 w-10 rounded-full bg-secondary-background-hover"
        />
        <span
          class="absolute bottom-2.5 left-2.5 h-1.5 w-14 rounded-full bg-secondary-background-hover"
        />
      </span>
    </div>
    <h2 class="text-heading font-semibold">{{ c.title }}</h2>
    <p class="mt-1.5 max-w-sm text-ui text-muted-foreground">{{ c.body }}</p>
    <div class="mt-6 flex gap-2">
      <Button variant="primary" @click="ask"><Sparkles :size="14" />Ask the agent</Button>
      <Button v-if="kind === 'workflows'" @click="hostActions.launch(activeInstance)"
        ><Rocket :size="14" />Open ComfyUI</Button
      >
      <Button variant="ghost" @click="alt"
        ><component :is="c.altIcon" :size="14" />{{ c.alt }}</Button
      >
    </div>
  </div>
</template>

<style scoped>
.ghost {
  transform: translateX(var(--x)) rotate(var(--r));
  transition: transform 400ms cubic-bezier(0.19, 1, 0.22, 1);
}
.front {
  transition: transform 400ms cubic-bezier(0.19, 1, 0.22, 1);
}
/* Hover the stack: the hand opens a little. Mouse only. */
@media (hover: hover) and (pointer: fine) {
  .hand:hover .ghost {
    transform: translateX(calc(var(--x) * 1.5)) rotate(calc(var(--r) * 1.4));
  }
  .hand:hover .front {
    transform: translateY(-3px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ghost,
  .front {
    transition: none;
  }
}
</style>
