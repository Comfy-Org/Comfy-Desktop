<script setup lang="ts">
import { computed } from 'vue'
import { Play } from 'lucide-vue-next'
import Button from '../ui/Button.vue'
import StatusDot from '../ui/StatusDot.vue'
import InstanceGlyph from './InstanceGlyph.vue'
import { envStatus } from './env/env'
import { go, hostActions, recentInstances } from '../useProto'

/** Second main action on Home: open ComfyUI in a recent environment. */
const recent = computed(() => recentInstances.value.slice(0, 3))
</script>

<template>
  <div class="mx-auto mt-8 w-full max-w-180">
    <div class="mb-2.5 flex items-center justify-between px-1">
      <span class="text-ui text-muted-foreground">Or launch ComfyUI</span>
      <Button variant="link" size="sm" @click="go('environments')">All builds</Button>
    </div>
    <div class="grid grid-cols-3 gap-2.5">
      <button
        v-for="i in recent"
        :key="i.id"
        type="button"
        class="edge-shine group relative flex h-14 min-w-0 items-center gap-3 rounded-card border bg-card-background/60 px-3 text-left outline-none transition-colors hover:bg-card-background hover:[--shine:0.22] focus-visible:ring-2 focus-visible:ring-border-focus"
        @click="hostActions.launch(i)"
      >
        <InstanceGlyph :inst="i" size="sm" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-ui font-medium">{{ i.name }}</span>
          <span class="flex items-center gap-1.5 truncate text-ui text-subtle-foreground"
            ><StatusDot v-if="envStatus(i).live" status="running" />{{ envStatus(i).label }}</span
          >
        </span>
        <Play
          :size="14"
          class="shrink-0 text-subtle-foreground transition-colors group-hover:text-base-foreground"
        />
      </button>
    </div>
  </div>
</template>
