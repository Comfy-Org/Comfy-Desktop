<script setup lang="ts">
import { Star } from 'lucide-vue-next'
import { MAX_STARS } from '../assets/assetRating'

const {
  label,
  stars = 0,
  count
} = defineProps<{
  label: string
  stars?: number
  count?: number
}>()
const SLOTS = Array.from({ length: MAX_STARS }, (_, i) => i + 1)
</script>

<template>
  <span v-if="stars" class="afm-grow afm-rating">
    <span class="afm-stars" role="img" :aria-label="label">
      <Star
        v-for="n in SLOTS"
        :key="n"
        :size="14"
        :class="n <= stars ? 'is-lit' : 'is-dim'"
        :fill="n <= stars ? 'currentColor' : 'none'"
      />
    </span>
    <span v-if="stars < MAX_STARS" class="afm-up" aria-hidden="true">&amp; up</span>
  </span>
  <span v-else class="afm-grow">{{ label }}</span>
  <span v-if="count !== undefined" class="afm-count">{{ count }}</span>
</template>

<style>
.afm-rating {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.afm-stars {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
}
.afm .afm-item .afm-stars svg {
  width: 14px;
  height: 14px;
  flex: none;
}
.afm-stars .is-lit {
  color: oklch(0.85 0.15 85);
}
.afm-stars .is-dim {
  color: color-mix(in oklch, var(--color-base-foreground) 28%, transparent);
}
:root[data-ds-theme='light'] .afm-stars .is-lit {
  color: oklch(0.76 0.16 75);
}
.afm-up {
  color: var(--color-muted-foreground);
}
.afm-count {
  min-width: 20px;
  flex: none;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.afm-check {
  display: inline-flex;
  width: 14px;
  flex: none;
  justify-content: center;
}
</style>
