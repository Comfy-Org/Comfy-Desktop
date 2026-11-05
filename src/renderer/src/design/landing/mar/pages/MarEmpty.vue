<script setup lang="ts">
import type { Component } from 'vue'
import Button from '../../ui/Button.vue'
import { brandMotif } from '../brand/brandMotif'
import MarTrio from '../brand/MarTrio.vue'

/**
 * Every empty state in Mar's proposal, in the Favorites design: a small
 * fan of three pictures of what will live here, a round badge with the
 * place's icon, a title, one line on what goes here, and the one action
 * that fills it (an optional quieter second). `compact` for a section
 * inside a page (a project's tab, a space's tab, a search with nothing);
 * no pictures shows the badge alone. With the brand motif on, the trio
 * takes the art's place and its open slab holds the icon.
 */
const {
  icon,
  title,
  text,
  action,
  second,
  pics = [],
  compact = false,
  tone
} = defineProps<{
  icon: Component
  title: string
  text: string
  action?: string
  second?: string
  pics?: string[]
  compact?: boolean
  /** `error`: the badge reads as a problem, not an invitation. */
  tone?: 'error'
}>()
const emit = defineEmits<{ action: []; second: [] }>()
</script>

<template>
  <section class="mar-empty" :class="[compact && 'is-compact', tone && `is-${tone}`]">
    <div v-if="brandMotif.id === 'trio'" class="mar-empty-trio mar-trio-host">
      <MarTrio :u="compact ? 20 : 32" :icon :icon-size="compact ? 10 : 14" />
    </div>
    <div v-else class="mar-empty-art" :class="!pics.length && 'is-bare'" aria-hidden="true">
      <img
        v-for="(src, i) in pics.slice(0, 3)"
        :key="src"
        :src
        alt=""
        class="mar-empty-pic"
        :class="`is-${i}`"
      />
      <span class="mar-empty-badge"
        ><component :is="icon" :size="compact ? 14 : 16" :stroke-width="2.25"
      /></span>
    </div>
    <div class="flex flex-col gap-1.5">
      <h2 class="mar-empty-h">{{ title }}</h2>
      <p class="mar-empty-p">{{ text }}</p>
    </div>
    <div v-if="action || second || $slots.default" class="flex items-center gap-2">
      <slot>
        <Button v-if="action" :variant="tone ? 'secondary' : 'primary'" @click="emit('action')">{{
          action
        }}</Button>
        <Button v-if="second" variant="ghost" @click="emit('second')">{{ second }}</Button>
      </slot>
    </div>
  </section>
</template>

<style>
.mar-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 72px 0 64px;
  text-align: center;
}
.mar-empty.is-compact {
  gap: 18px;
  padding: 44px 0 36px;
}
.mar-empty-trio {
  padding: 8px;
}
.mar-empty-art {
  position: relative;
  width: 224px;
  height: 128px;
}
.is-compact .mar-empty-art {
  width: 168px;
  height: 96px;
}
.mar-empty-art.is-bare {
  width: 48px;
  height: 48px;
}
.mar-empty-pic {
  position: absolute;
  top: 8px;
  left: 50%;
  width: 96px;
  height: 112px;
  border-radius: var(--radius-card, 12px);
  object-fit: cover;
  box-shadow:
    0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent),
    0 12px 32px rgb(0 0 0 / 0.32);
  transition: transform 400ms cubic-bezier(0.19, 1, 0.22, 1);
}
.is-compact .mar-empty-pic {
  width: 72px;
  height: 84px;
}
.mar-empty-pic.is-0 {
  transform: translateX(-92%) rotate(-8deg);
}
.mar-empty-pic.is-1 {
  z-index: 1;
  transform: translate(-50%, -6px);
}
.mar-empty-pic.is-2 {
  transform: translateX(-8%) rotate(8deg);
}
/* Mouse only: the hand opens a little. */
@media (hover: hover) and (pointer: fine) {
  .mar-empty-art:hover .mar-empty-pic.is-0 {
    transform: translateX(-104%) rotate(-11deg);
  }
  .mar-empty-art:hover .mar-empty-pic.is-2 {
    transform: translateX(4%) rotate(11deg);
  }
}
.mar-empty-badge {
  position: absolute;
  bottom: -14px;
  left: 50%;
  z-index: 2;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 999px;
  /* Mixed on the page's colour, so it stays solid over the fan. */
  background: color-mix(
    in oklch,
    var(--color-base-foreground) 12%,
    var(--color-content-background)
  );
  /* The page's colour as a ring: the badge is cut out of the fan. */
  box-shadow: 0 0 0 4px var(--color-content-background);
  color: var(--color-base-foreground);
  transform: translateX(-50%);
}
.mar-empty-art.is-bare .mar-empty-badge {
  bottom: 0;
  width: 48px;
  height: 48px;
  box-shadow: none;
}
.mar-empty.is-error .mar-empty-badge {
  background: var(--color-card-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-empty-h {
  margin: 0;
  color: var(--color-base-foreground);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.25;
}
:root .proto-ui.proto-ui.proto-ui .is-compact .mar-empty-h {
  font-size: 15px;
}
.mar-empty-p {
  max-width: 24rem;
  margin: 0;
  color: var(--color-muted-foreground);
  font-size: 13px;
  line-height: 1.5;
  text-wrap: pretty;
}
@media (prefers-reduced-motion: reduce) {
  .mar-empty-pic {
    transition: none;
  }
}
</style>
