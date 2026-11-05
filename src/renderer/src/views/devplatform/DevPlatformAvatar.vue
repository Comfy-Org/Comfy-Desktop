<script setup lang="ts">
import { computed } from 'vue'

const { name, neutral } = defineProps<{
  name: string
  neutral?: boolean
}>()

const letter = computed(() => name?.charAt(0)?.toUpperCase() || '?')

function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const gradient = computed(() => {
  const rand = mulberry32(letter.value.charCodeAt(0))
  const hue1 = Math.floor(rand() * 360)
  const hue2 = (hue1 + 18 + Math.floor(rand() * 24)) % 360
  const sat = 65 + Math.floor(rand() * 20)
  const light = 55 + Math.floor(rand() * 15)
  return `linear-gradient(135deg, hsl(${hue1}, ${sat}%, ${light + 6}%), hsl(${hue2}, ${sat}%, ${light - 6}%))`
})
</script>

<template>
  <span
    class="dp-avatar inline-flex size-[var(--dp-avatar-size,32px)] flex-none items-center justify-center overflow-hidden rounded-md text-[length:calc(var(--dp-avatar-size,32px)*0.42)] leading-none font-semibold text-white select-none"
    :class="
      neutral
        ? 'dp-avatar--neutral bg-neutral-400 [text-shadow:none]'
        : '[text-shadow:0_1px_2px_rgba(0,0,0,0.2)]'
    "
    :style="neutral ? undefined : { background: gradient }"
    aria-hidden="true"
  >
    {{ neutral ? '' : letter }}
  </span>
</template>
