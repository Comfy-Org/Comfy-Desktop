<script setup lang="ts">
import { computed } from 'vue'
import Avatar from '../ui/Avatar.vue'
import { cn } from '../ui/cn'

/** Round initial avatar. Shades come from a fixed grey ramp (no hues),
 *  picked by name so a person keeps theirs. */
const {
  name,
  size = 'md',
  class: className
} = defineProps<{ name: string; size?: 'sm' | 'md' | 'lg'; class?: string }>()
const SHADES = ['bg-[#55555a]', 'bg-[#46464b]', 'bg-[#3a3a3e]', 'bg-[#606066]']
const shade = computed(
  () => SHADES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % SHADES.length]
)
</script>

<template>
  <Avatar :size tone="solid" :class="cn('rounded-full font-medium', shade, className)">{{
    name.charAt(0)
  }}</Avatar>
</template>
