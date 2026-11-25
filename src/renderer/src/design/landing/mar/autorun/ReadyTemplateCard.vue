<script setup lang="ts">
import { Play, X } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { dismissReady, readyTemplate, runTemplate, shortName } from './autorun'
</script>

<template>
  <div
    v-if="readyTemplate"
    class="mar-surface mt-10 flex items-center gap-3 rounded-card p-1.5 pr-2"
    data-ready-template
  >
    <img :src="readyTemplate.src" alt="" class="size-9 shrink-0 rounded-control object-cover" />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-ui font-medium"
        >{{ shortName(readyTemplate.t) }} is ready</span
      >
      <span class="block truncate text-ui text-muted-foreground"
        >Downloaded to {{ readyTemplate.inst.name }}. Run it with its example to see a first
        result.</span
      >
    </span>
    <Button variant="primary" size="sm" @click="runTemplate(readyTemplate.t, readyTemplate.inst)">
      <Play :size="13" fill="currentColor" />Run it
    </Button>
    <Tooltip content="Dismiss">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss"
        @click="dismissReady(readyTemplate.t.id, readyTemplate.inst.id)"
      >
        <X :size="15" />
      </Button>
    </Tooltip>
  </div>
</template>
