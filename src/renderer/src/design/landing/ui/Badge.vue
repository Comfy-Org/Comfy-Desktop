<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'
import { badgeVariants, type BadgeVariants } from './badge.variants'

const { class: className } = defineProps<{
  variant?: BadgeVariants['variant']
  size?: BadgeVariants['size']
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <span :class="cn(badgeVariants({ variant, size }), className)"><slot /></span>
</template>
