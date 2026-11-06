<script setup lang="ts">
import { computed } from 'vue'
import { KEY_SECTIONS, takeSection, useMode } from './mode'

/** A titled block of a page: one axis of a component (states, menus…).
 *  As the hero (kit/mode.ts) only the hero section shows, untitled. */
defineProps<{ title: string; note?: string }>()
const ctx = useMode()
const index = takeSection()
// States: the first sections, the rest behind “Show all states”.
const shown = computed(() =>
  ctx.mode === 'hero' || ctx.mode === 'specs'
    ? index === ctx.hero[0]
    : ctx.mode !== 'states' || index < KEY_SECTIONS || ctx.showAll.value
)
const bare = ctx.mode === 'hero' || ctx.mode === 'specs'
</script>

<template>
  <section v-if="shown" :class="['ds-section', bare && 'is-hero']">
    <header v-if="!bare">
      <h2 class="ds-section-title">{{ title }}</h2>
      <p v-if="note" class="ds-section-note">{{ note }}</p>
    </header>
    <slot />
  </section>
</template>
