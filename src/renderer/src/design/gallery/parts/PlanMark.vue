<script setup lang="ts">
import { computed } from 'vue'
import { Check } from 'lucide-vue-next'
import { markOf } from '../consolidate/session'
import { shortName, type Token } from '../tokens'

/** A token's fate in the open consolidation, shown under its sample:
 *  kept (and how many merge into it), merging into another, changing
 *  value, or picked for a merge by hand. Renders nothing otherwise. */
const { token } = defineProps<{ token: Token }>()
const mark = computed(() => markOf(token))
</script>

<template>
  <span
    v-if="mark?.kind === 'keep' || (mark?.kind === 'picked' && mark.keep)"
    class="inline-flex h-5 shrink-0 items-center gap-1 self-start rounded-full bg-(--gallery-accent)/15 px-2 font-sans text-ui font-medium text-base-foreground"
    ><Check :size="11" class="text-(--gallery-accent)" />Keep<template v-if="mark.kind === 'keep'">
      · +{{ mark.absorbs }}</template
    ></span
  >
  <span
    v-else-if="mark?.kind === 'picked'"
    class="inline-flex h-5 shrink-0 items-center self-start rounded-full px-2 font-sans text-ui font-medium text-base-foreground ring-1 ring-(--gallery-accent) ring-inset"
    >Picked</span
  >
  <span
    v-else-if="mark?.kind === 'retire'"
    class="inline-flex h-5 min-w-0 items-center truncate font-mono text-ui text-subtle-foreground"
    >→ {{ shortName(mark.into) }}</span
  >
  <span
    v-else-if="mark?.kind === 'set'"
    class="inline-flex h-5 shrink-0 items-center font-mono text-ui text-base-foreground"
    >→ {{ mark.value }}</span
  >
</template>
