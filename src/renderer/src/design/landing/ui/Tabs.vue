<script setup lang="ts" generic="T extends string">
import { TabsContent, TabsIndicator, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import type { Component, HTMLAttributes } from 'vue'
import { isMariana } from '../mar/proposal'

export interface TabOption<V extends string = string> {
  value: V
  label: string
  icon?: Component
  count?: number
}

/** Underline tabs for page-level views. The default slot is the active
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
    <div
      class="flex justify-between gap-4"
      :class="isMariana ? 'items-center' : 'items-end border-b border-border-default'"
    >
      <TabsList :class="isMariana ? 'mar-pseg relative' : 'relative flex gap-5'">
        <TabsTrigger
          v-for="o in options"
          :key="o.value"
          :value="o.value"
          :class="
            isMariana
              ? 'mar-pseg-btn inline-flex items-center gap-1.5'
              : 'inline-flex h-10 items-center gap-1.5 text-ui text-muted-foreground outline-none transition-colors hover:text-base-foreground focus-visible:text-base-foreground data-[state=active]:text-base-foreground'
          "
        >
          <component :is="o.icon" v-if="o.icon" :size="14" />
          {{ o.label }}
          <span
            v-if="o.count !== undefined"
            :class="isMariana ? 'mar-pseg-count' : 'text-ui text-subtle-foreground tabular-nums'"
            >{{ o.count }}</span
          >
        </TabsTrigger>
        <TabsIndicator
          v-if="!isMariana"
          class="absolute -bottom-px left-0 h-0.5 w-(--reka-tabs-indicator-size) translate-x-(--reka-tabs-indicator-position) rounded-full bg-base-foreground transition-[width,translate] duration-200 ease-out-expo"
        />
      </TabsList>
      <div v-if="$slots.actions" class="flex items-center gap-2" :class="!isMariana && 'pb-1.5'">
        <slot name="actions" />
      </div>
    </div>
    <TabsContent :value="model" class="outline-none"><slot /></TabsContent>
  </TabsRoot>
</template>
