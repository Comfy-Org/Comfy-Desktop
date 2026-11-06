<script setup lang="ts">
import type { Component } from 'vue'
import { ChartColumn, Gauge, Server } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { cn } from '../../ui/cn'
import { go, proto, type Page } from '../../useProto'

/**
 * The sidebar before Home (Milestones 2-3), as Desktop has it today
 * (panel/AppSidebar.vue on bl/desktop-as-a-platform): one Builds row, then
 * Tools with Benchmarks and Performance Tests. A build opens from the list.
 */
interface Row {
  page: Page
  label: string
  icon: Component
  prefix?: string
}
const GROUPS: { title?: string; rows: Row[] }[] = [
  { rows: [{ page: 'environments', label: 'Builds', icon: Server, prefix: 'environment:' }] },
  {
    title: 'Tools',
    rows: [
      { page: 'tool:benchmarks', label: 'Benchmarks', icon: ChartColumn },
      { page: 'tool:performance', label: 'Performance Tests', icon: Gauge }
    ]
  }
]
const isOn = (r: Row): boolean =>
  proto.page === r.page || Boolean(r.prefix && proto.page.startsWith(r.prefix))
</script>

<template>
  <nav class="mt-1 flex shrink-0 flex-col" aria-label="Navigation">
    <template v-for="(g, gi) in GROUPS" :key="gi">
      <p v-if="g.title" class="mar-bnav-title">{{ g.title }}</p>
      <Button
        v-for="r in g.rows"
        :key="r.page"
        variant="ghost"
        :aria-current="isOn(r) ? 'page' : undefined"
        :class="
          cn(
            'h-8 w-full justify-start gap-2.5 px-3 text-ui font-normal',
            isOn(r) && 'bg-secondary-background-hover text-base-foreground'
          )
        "
        @click="go(r.page)"
      >
        <component :is="r.icon" :size="15" />
        <span class="sidebar-label text-left">{{ r.label }}</span>
      </Button>
    </template>
  </nav>
</template>

<style>
.mar-bnav-title {
  margin: 20px 0 4px;
  padding: 0 12px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-weight: 500;
}
</style>
