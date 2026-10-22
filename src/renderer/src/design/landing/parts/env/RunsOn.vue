<script setup lang="ts">
import { computed } from 'vue'
import { Cloud, Laptop, Rocket } from 'lucide-vue-next'
import StatusDot from '../../ui/StatusDot.vue'
import { runsOn } from './env'
import { can } from '../../milestones'
import type { ProtoInstance } from '../../mock'

/** "Runs on" as its own line: where an environment is, separate from what
 *  it is. Local is one place; cloud can be many (deployments). */
const { env } = defineProps<{ env: ProtoInstance }>()
// Deployments come with the Builder (Milestone 6).
const items = computed(() =>
  runsOn(env).filter((r) => r.where !== 'deployments' || can.value.builder)
)
const ICON = { computer: Laptop, cloud: Cloud, deployments: Rocket }
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <span
      v-for="r in items"
      :key="r.where"
      class="inline-flex h-6 items-center gap-1.5 rounded-full border border-border-default px-2 text-ui text-muted-foreground"
    >
      <component :is="ICON[r.where]" :size="12" />{{ r.label }}
      <StatusDot v-if="r.live" status="running" />
    </span>
  </div>
</template>
