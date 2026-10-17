<script setup lang="ts" generic="T extends string">
import { TabsContent, TabsIndicator, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import type { HTMLAttributes } from 'vue'

/** Underline tabs for page-level views. The default slot is the active panel. */
const { options, class: className } = defineProps<{
  options: { value: T; label: string }[]
  class?: HTMLAttributes['class']
}>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <TabsRoot v-model="model" :class="className">
    <TabsList class="relative flex gap-5 border-b border-border-default">
      <TabsTrigger
        v-for="o in options"
        :key="o.value"
        :value="o.value"
        class="inline-flex h-10 items-center text-ui text-muted-foreground outline-none transition-colors hover:text-base-foreground focus-visible:text-base-foreground data-[state=active]:text-base-foreground"
      >
        {{ o.label }}
      </TabsTrigger>
      <TabsIndicator
        class="absolute -bottom-px left-0 h-0.5 w-(--reka-tabs-indicator-size) translate-x-(--reka-tabs-indicator-position) rounded-full bg-base-foreground transition-[width,translate] duration-200 ease-out-expo"
      />
    </TabsList>
    <TabsContent :value="model" class="outline-none"><slot /></TabsContent>
  </TabsRoot>
</template>
