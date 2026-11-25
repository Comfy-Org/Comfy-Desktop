<script setup lang="ts">
import { computed, type Component } from 'vue'
import { ArrowDownToLine, Ban, CircleCheck, Cloud, Coins, UserRound, Wrench } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import { readinessFor, type Readiness } from './runReadiness'

const { id } = defineProps<{ id: string }>()

const ICONS: Record<Readiness, Component> = {
  ready: CircleCheck,
  download: ArrowDownToLine,
  cloud: Cloud,
  credits: Coins,
  signIn: UserRound,
  setup: Wrench,
  blocked: Ban
}

const r = computed(() => readinessFor(id))
</script>

<template>
  <Badge
    v-if="r"
    variant="overlay"
    class="mar-ready max-w-full gap-1.5 pr-2.5 pl-2 text-white"
    :data-ready="r.kind"
    :title="r.detail"
  >
    <component
      :is="ICONS[r.kind]"
      :size="12"
      :stroke-width="2.25"
      class="mar-ready-icon shrink-0"
    />
    <span class="truncate">{{ r.label }}</span>
  </Badge>
</template>

<style scoped>
.mar-ready {
  backdrop-filter: blur(14px) saturate(1.5);
}
.mar-ready[data-ready='ready'] .mar-ready-icon {
  color: oklch(from var(--color-status-running) max(l, 0.78) c h);
}
.mar-ready-icon {
  color: rgb(255 255 255 / 0.8);
}
</style>
