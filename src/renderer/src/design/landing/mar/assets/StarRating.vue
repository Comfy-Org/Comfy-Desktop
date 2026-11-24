<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { Star } from 'lucide-vue-next'
import { onClickOutside } from '@vueuse/core'
import { MAX_STARS } from './assetRating'

/** One to five stars, where a card has room for one (UI Playground ›
 *  Rating › Five stars). Unrated, it is the single star Assets already
 *  has; a tap opens the five and you pick how many, and the star you
 *  picked again takes the rating off. Rated, it reads as the stars it
 *  holds and a tap opens the five again. Inside the asset's details
 *  (`open`) the five stay out, with no tap to open them. */
const { value, open = false } = defineProps<{ value: number; open?: boolean }>()
const emit = defineEmits<{ set: [n: number] }>()

const picking = ref(false)
const hover = ref(0)
const root = useTemplateRef<HTMLElement>('root')
onClickOutside(root, () => (picking.value = false))

const showing = computed(() => open || picking.value)
// Picking: the stars follow the pointer, so you see what you'd get.
const shown = computed(() => (showing.value && hover.value ? hover.value : value))
const stars = computed(() =>
  showing.value || value
    ? Array.from({ length: showing.value ? MAX_STARS : value }, (_, i) => i + 1)
    : [0]
)

function pick(n: number): void {
  emit('set', n === value ? 0 : n)
  picking.value = false
  hover.value = 0
}
function click(n: number): void {
  if (showing.value) pick(n)
  else picking.value = true
}
</script>

<template>
  <span
    ref="root"
    class="mar-stars"
    :class="[showing && 'is-open', !open && 'is-card']"
    @mouseleave="hover = 0"
    @keydown.esc.stop="picking = false"
  >
    <button
      v-for="n in stars"
      :key="n"
      type="button"
      :aria-label="
        showing
          ? `${n} star${n > 1 ? 's' : ''}`
          : value
            ? `Rated ${value} of ${MAX_STARS}`
            : 'Rate this file'
      "
      :aria-pressed="showing ? n <= value : undefined"
      :title="showing ? undefined : value ? `Rated ${value} of ${MAX_STARS}` : 'Rate this file'"
      @click.stop="click(Math.max(n, 1))"
      @dblclick.stop
      @mouseenter="showing && (hover = n)"
    >
      <Star :size="13" :fill="n <= shown && n > 0 ? 'currentColor' : 'none'" />
    </button>
  </span>
</template>

<style>
.mar-stars {
  display: inline-flex;
  align-items: center;
}
.mar-stars button {
  display: inline-flex;
  padding: 0 1px;
  border: 0;
  background: none;
  color: var(--color-muted-foreground);
  cursor: pointer;
}
.mar-stars button:hover,
.mar-stars.is-open button {
  color: var(--color-base-foreground);
}
/* On a card the control sits in the hover tools, so it keeps their
   height and only widens while you are picking. */
.mar-stars.is-card {
  height: 22px;
  border-radius: 999px;
  padding: 0 3px;
}
.mar-stars.is-card.is-open {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  backdrop-filter: blur(6px);
}
</style>
