<script setup lang="ts">
import { computed } from 'vue'
import LocationIcon from '../ui/LocationIcon.vue'
import { envKind } from '../parts/env/env'
import { hostActions } from '../useProto'
import type { ProtoInstance } from '../mock'

/** A build to launch, as a compact row: where it runs in a well, name
 *  and place, then its state. Click launches ComfyUI on that build. */
const { inst } = defineProps<{ inst: ProtoInstance }>()

const where = computed(
  () => ({ local: 'This computer', managed: 'Always on', cloud: 'Comfy Cloud' })[envKind(inst)]
)
const state = computed(() => {
  if (inst.state === 'update') return { label: 'Update', live: false }
  if (inst.state === 'running' || envKind(inst) === 'managed')
    return { label: 'Running', live: true }
  return { label: 'Stopped', live: false }
})
</script>

<template>
  <button
    type="button"
    class="mar-surface flex min-w-0 items-center gap-3 rounded-card p-1.5 pr-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus"
    @click="hostActions.launch(inst)"
  >
    <span class="mar-well flex size-10 shrink-0 items-center justify-center rounded-control">
      <LocationIcon :kind="inst.kind === 'cloud' ? 'cloud' : 'local'" :size="16" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-ui font-medium">{{ inst.name }}</span>
      <span class="block truncate text-ui text-subtle-foreground">{{ where }}</span>
    </span>
    <span
      :class="[
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium',
        state.live ? 'bg-status-running/15 text-status-running' : 'mar-well text-muted-foreground'
      ]"
    >
      <span v-if="state.live" class="size-1.5 rounded-full bg-status-running" />{{ state.label }}
    </span>
  </button>
</template>
