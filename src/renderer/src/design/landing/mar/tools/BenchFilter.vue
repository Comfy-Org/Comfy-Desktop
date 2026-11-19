<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import { cn } from '../../ui/cn'
import { fieldVariants } from '../../ui/field.variants'

/**
 * One of Benchmarks' toolbar menus (Comfy-Desktop#2015): the muted name,
 * what's picked and a chevron, opening the filter menu. A single choice
 * fills the picked row, no check.
 */
const { label, options } = defineProps<{
  label: string
  options: { value: string; label: string }[]
}>()
const model = defineModel<string>({ required: true })
const current = computed(() => options.find((o) => o.value === model.value)?.label ?? '')
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger
      :aria-label="`${label}: ${current}`"
      :class="
        cn(
          fieldVariants(),
          'bench-filter w-auto max-w-64 min-w-0 cursor-pointer gap-1.5 pr-2 outline-none focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus/30 data-[state=open]:border-border-strong'
        )
      "
    >
      <span class="shrink-0 text-subtle-foreground">{{ label }}</span>
      <span class="truncate">{{ current }}</span>
      <ChevronDown :size="13" class="ml-auto shrink-0 text-subtle-foreground" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="flex min-w-[180px] flex-col gap-0.5">
      <DropdownMenuItem
        v-for="o in options"
        :key="o.value"
        role="menuitemradio"
        :aria-checked="o.value === model"
        :class="o.value === model && 'bg-secondary-background'"
        @select="model = o.value"
        ><span class="min-w-0 flex-1 truncate" :title="o.label">{{
          o.label
        }}</span></DropdownMenuItem
      >
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>
