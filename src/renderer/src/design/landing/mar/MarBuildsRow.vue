<script setup lang="ts">
import { computed } from 'vue'
import Card from '../ui/Card.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import StatusDot from '../ui/StatusDot.vue'
import LocationIcon from '../ui/LocationIcon.vue'
import { envStatus } from '../parts/env/env'
import { go, hostActions, recentInstances } from '../useProto'
import { can } from '../milestones'
import SetupLaptop from './setup/SetupLaptop.vue'
import SetupCloud from './setup/SetupCloud.vue'
import { localSetup } from './setup/setupFlow'
import './setup/setup.css'

/** Home's builds in Mar's proposal (UI Playground › Build on Home): what
 *  Pablo's Home shows (three recent builds, their state, click to launch
 *  ComfyUI on one), as one row of cards like Spaces. */
const shown = computed(() => recentInstances.value.slice(0, 3))
/** From Milestone 2 on, each build is the install card made small:
 *  the machine drawn, its state, its name, what it runs on. Each one is
 *  its own: lit in the build's hue, and saying what it holds. */
const machine = computed(() => can.value.exploreApps)
// The drawing says where it runs; the line says on what.
const detail = (i: (typeof shown.value)[number]): string =>
  [i.gpu, i.version].filter(Boolean).join(' · ')
const holds = (i: (typeof shown.value)[number]): string =>
  i.models
    ? `${i.models} models · ${i.nodes ?? 0} node packs`
    : i.kind === 'cloud'
      ? 'Every model, ready'
      : 'Fresh build'
</script>

<template>
  <section class="mt-10">
    <SectionHeader title="Builds" link="All builds" @link="go('environments')" />
    <!-- One, two or three builds always fill the row. -->
    <div
      class="grid gap-3.5"
      :style="{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }"
    >
      <template v-if="machine">
        <button
          v-for="i in shown"
          :key="i.id"
          type="button"
          class="mbr-card"
          :style="{ '--h': i.hue }"
          @click="hostActions.launch(i)"
        >
          <span class="mbr-device">
            <SetupCloud v-if="i.kind === 'cloud'" :hue="i.hue" />
            <template v-else>
              <SetupLaptop :os="localSetup.os" />
              <!-- The build's hue on its screen. -->
              <span class="mbr-screen" aria-hidden="true"></span>
            </template>
          </span>
          <span class="grid min-w-0 flex-1">
            <span class="mss-machine-kicker"
              ><StatusDot v-if="envStatus(i).live" status="running" />{{ envStatus(i).label }}</span
            >
            <span class="mbr-name">{{ i.name }}</span>
            <span class="mbr-meta">{{ detail(i) }}</span>
            <span class="mbr-holds">{{ holds(i) }}</span>
          </span>
        </button>
      </template>
      <template v-else>
        <Card
          v-for="i in shown"
          :key="i.id"
          as="button"
          interactive
          class="mar-row-card"
          @click="hostActions.launch(i)"
        >
          <span class="mar-row-icon">
            <LocationIcon :kind="i.kind === 'cloud' ? 'cloud' : 'local'" :size="18" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="block truncate text-ui font-medium">{{ i.name }}</span>
            <!-- Only the label truncates, so the running dot's halo isn't clipped. -->
            <span class="flex min-w-0 items-center gap-1.5 text-ui text-subtle-foreground"
              ><StatusDot v-if="envStatus(i).live" status="running" /><span class="truncate">{{
                envStatus(i).label
              }}</span></span
            >
          </span>
        </Card>
      </template>
    </div>
  </section>
</template>

<style>
/* The install card (HomeInstall.vue), small: a surface with a soft light
 * at its corner, the machine drawn on the left. */
:root .proto-ui.proto-ui.proto-ui .mbr-card {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 18px;
  padding: 20px 20px 20px 18px;
  border-radius: 16px;
  /* Lit from its corner in the build's own hue. */
  background:
    radial-gradient(ellipse 60% 130% at 8% 0%, oklch(0.7 0.15 var(--h, 0) / 0.3), transparent 70%),
    oklch(0.6 0 0 / 0.05);
  box-shadow: inset 0 0 0 1px oklch(0.8 0.06 var(--h, 0) / 0.1);
  text-align: left;
  transition: background-color 0.15s;
}
/* On hover the hue spreads from the lit corner across the card. */
.mbr-card::before {
  position: absolute;
  z-index: -1;
  background: radial-gradient(
    ellipse 130% 170% at 0 0,
    oklch(0.7 0.15 var(--h, 0) / 0.4),
    oklch(0.6 0.13 var(--h, 0) / 0.14) 50%,
    transparent 85%
  );
  clip-path: circle(0% at 0 0);
  content: '';
  inset: 0;
  transition: clip-path 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}
.mbr-card:hover::before {
  clip-path: circle(150% at 0 0);
}
@media (prefers-reduced-motion: reduce) {
  .mbr-card::before {
    transition-duration: 0s;
  }
}
.mbr-card .mss-laptop {
  width: 88px;
  height: 57px;
}
.mbr-device {
  position: relative;
  display: block;
  flex: none;
}
/* Over the laptop's screen (its box in SetupLaptop's 160 × 104 drawing). */
.mbr-screen {
  position: absolute;
  top: 8.2%;
  right: 14%;
  bottom: 22.6%;
  left: 14%;
  border-radius: 2px;
  background: radial-gradient(
    ellipse 90% 90% at 30% 25%,
    oklch(0.74 0.16 var(--h, 0) / 0.8),
    oklch(0.55 0.14 var(--h, 0) / 0.3) 65%,
    transparent
  );
  mix-blend-mode: screen;
  pointer-events: none;
}
.mbr-name {
  overflow: hidden;
  color: var(--color-base-foreground);
  margin-bottom: 2px;
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mbr-holds {
  margin-top: 6px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.mbr-meta {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
