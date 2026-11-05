<script setup lang="ts" generic="T extends string">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import type { Component, HTMLAttributes } from 'vue'

export interface TabOption<V extends string = string> {
  value: V
  label: string
  icon?: Component
  count?: number
}

/** Tabs for page-level views. The default slot is the active
 *  panel; `actions` sits at the right end of the tab rail. Mar's proposal
 *  draws them as its segmented tabs (MarSeg's track and items). */
const { options, class: className } = defineProps<{
  options: TabOption<T>[]
  class?: HTMLAttributes['class']
}>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <TabsRoot v-model="model" :class="className">
    <div class="flex items-center justify-between gap-4">
      <TabsList class="mar-pseg relative">
        <TabsTrigger
          v-for="o in options"
          :key="o.value"
          :value="o.value"
          class="mar-pseg-btn inline-flex items-center gap-1.5"
        >
          <component :is="o.icon" v-if="o.icon" :size="14" />
          {{ o.label }}
          <span v-if="o.count !== undefined" class="mar-pseg-count">{{ o.count }}</span>
        </TabsTrigger>
      </TabsList>
      <div v-if="$slots.actions" class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <TabsContent :value="model" class="outline-none"><slot /></TabsContent>
  </TabsRoot>
</template>
