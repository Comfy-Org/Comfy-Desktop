<script setup lang="ts" generic="T extends string">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import type { Component, HTMLAttributes } from 'vue'

export interface TabOption<V extends string = string> {
  value: V
  label: string
  icon?: Component
  count?: number
}

/** Tabs for page-level views, on a track. The default slot is the active
 *  panel; `actions` sits at the right end of the tab rail. */
const { options, class: className } = defineProps<{
  options: TabOption<T>[]
  class?: HTMLAttributes['class']
}>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <TabsRoot v-model="model" :class="className">
    <div class="flex items-center justify-between gap-4">
      <TabsList class="inline-flex shrink-0 gap-0.5 rounded-track bg-secondary-background p-0.75">
        <TabsTrigger
          v-for="o in options"
          :key="o.value"
          :value="o.value"
          class="inline-flex h-6.5 items-center gap-1.5 rounded-track-item px-2.75 text-ui whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus data-[state=active]:bg-secondary-background-hover data-[state=active]:text-base-foreground"
        >
          <component :is="o.icon" v-if="o.icon" :size="14" />
          {{ o.label }}
        </TabsTrigger>
      </TabsList>
      <div v-if="$slots.actions" class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <TabsContent :value="model" class="outline-none"><slot /></TabsContent>
  </TabsRoot>
</template>
