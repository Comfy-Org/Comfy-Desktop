<script setup lang="ts">
import { computed } from 'vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import SpaceMark from '../../parts/space/SpaceMark.vue'
import { SPACES, type Space } from '../../spaces'
import { go } from '../../useProto'
import portraitGarden from '../assets/portrait-garden.jpg'
import portraitSmile from '../assets/portrait-smile.jpg'
import portraitWindow from '../assets/portrait-window.jpg'
import portraitSeaside from '../assets/portrait-seaside.jpg'
import portraitGrass from '../assets/portrait-grass.jpg'

/**
 * 07 · Gradient spaces: each space is known by its colour. The brand
 * colour washes down from the top of the card; its logo sits on it (a lit
 * orb when it has none)
 * (never an empty circle); under it the name, the address, who's in it,
 * what it has and that it's live. Home shows the three live spaces;
 * drafts and the rest are in All spaces.
 */
const shown = computed(() => SPACES.filter((s) => s.status === 'live').slice(0, 3))

const FACES = [portraitGarden, portraitSmile, portraitWindow, portraitSeaside, portraitGrass]
const faces = (s: Space, i: number): string[] =>
  s.members.slice(0, 3).map((_, k) => FACES[(i + k * 2) % FACES.length]!)
const tools = (s: Space): number => s.catalog.filter((c) => c.visible).length
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`
const people = (n: number): string => (n === 1 ? '1 person' : `${n} people`)
</script>

<template>
  <section class="mt-10">
    <SectionHeader title="Spaces" link="All spaces" @link="go('spaces')">
      <template #controls>
        <span class="text-ui text-subtle-foreground">{{ SPACES.length }}</span>
      </template>
    </SectionHeader>
    <div class="grid grid-cols-3 gap-3.5">
      <button
        v-for="(s, i) in shown"
        :key="s.id"
        type="button"
        class="p07-card group"
        :style="{ '--brand': s.brand.color }"
        @click="go(`space:${s.id}`)"
      >
        <span class="p07-wash" aria-hidden="true" />
        <!-- The space's logo; the lit orb only when it has none. -->
        <SpaceMark
          v-if="s.brand.logo.icon"
          :brand="s.brand"
          size="lg"
          class="p07-logo"
          aria-hidden="true"
        />
        <span v-else class="p07-orb" aria-hidden="true" />
        <span class="absolute top-[148px] right-[18px] left-[18px] flex flex-col gap-0.5">
          <span
            class="truncate text-[17px] leading-[1.4] font-semibold tracking-[-0.01em] text-base-foreground"
            >{{ s.name }}</span
          >
          <span class="truncate text-[12px] leading-[1.4] text-subtle-foreground">{{
            s.domain
          }}</span>
        </span>
        <span class="absolute right-[18px] bottom-[18px] left-[18px] flex items-center gap-2.5">
          <span class="flex shrink-0 items-center">
            <img
              v-for="(f, k) in faces(s, i)"
              :key="k"
              :src="f"
              alt=""
              class="p07-face size-6 rounded-full object-cover"
              :style="{ zIndex: 3 - k }"
            />
          </span>
          <span class="min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-muted-foreground"
            >{{ plural(tools(s), 'tool') }} · {{ people(s.members.length) }}</span
          >
          <span
            class="p07-live inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-[7px] px-[7px] text-[11px] font-medium"
          >
            <span class="size-1.5 rounded-full bg-current" />Live
          </span>
        </span>
      </button>
    </div>
  </section>
</template>

<style scoped>
/* The brand colour from the top, fading out before the name. */
.p07-wash {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      120% 75% at 15% 0%,
      color-mix(in oklch, var(--brand) 70%, transparent) 0%,
      color-mix(in oklch, var(--brand) 22%, transparent) 50%,
      transparent 78%
    ),
    linear-gradient(
      to bottom,
      color-mix(in oklch, var(--brand) 38%, transparent) 0%,
      transparent 62%
    );
  transition: opacity 300ms ease;
}
.p07-card:hover .p07-wash {
  opacity: 0.88;
}
/* A lit sphere in the brand colour: highlight top-left, shade bottom-right. */
.p07-orb {
  position: absolute;
  top: 84px;
  left: 18px;
  width: 48px;
  height: 48px;
  border-radius: 9999px;
  background: radial-gradient(
    circle at 32% 28%,
    color-mix(in oklch, var(--brand) 35%, white) 0%,
    var(--brand) 45%,
    color-mix(in oklch, var(--brand) 65%, black) 100%
  );
  box-shadow: 0 10px 24px -8px color-mix(in oklch, var(--brand) 70%, transparent);
}
.p07-logo {
  position: absolute;
  top: 84px;
  left: 18px;
}
.p07-logo :deep(> span:first-child) {
  box-shadow: 0 10px 24px -10px color-mix(in oklch, var(--brand) 70%, transparent);
}
.p07-face {
  box-shadow: 0 0 0 2px
    color-mix(in oklch, var(--color-card-background) 72%, var(--color-content-background));
}
.p07-face + .p07-face {
  margin-left: -6px;
}
.p07-live {
  color: var(--color-status-running);
  background-color: color-mix(in oklch, var(--color-status-running) 14%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .p07-wash {
    transition: none;
  }
}
</style>

<style>
:root .proto-ui.proto-ui.proto-ui .p07-card {
  position: relative;
  display: block;
  width: 100%;
  height: 250px;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border-radius: 18px;
  text-align: left;
  background-color: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  backdrop-filter: blur(24px);
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .p07-card:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
</style>
