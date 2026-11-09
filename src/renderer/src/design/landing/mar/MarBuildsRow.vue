<script setup lang="ts">
import { computed } from 'vue'
import { Cloud } from 'lucide-vue-next'
import Card from '../ui/Card.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import StatusDot from '../ui/StatusDot.vue'
import LocationIcon from '../ui/LocationIcon.vue'
import { envStatus } from '../parts/env/env'
import { go, hostActions, recentInstances } from '../useProto'
import { can } from '../milestones'
import SetupLaptop from './setup/SetupLaptop.vue'
import { localSetup } from './setup/setupFlow'
import './setup/setup.css'

/** Home's builds in Mar's proposal (UI Playground › Build on Home): what
 *  Pablo's Home shows (three recent builds, their state, click to launch
 *  ComfyUI on one), as one row of cards like Spaces. */
const shown = computed(() => recentInstances.value.slice(0, 3))
/** From Agent (future) on, each build is the install card made small:
 *  the machine drawn, its state, its name, what it runs on. */
const machine = computed(() => can.value.agent)
// The drawing says where it runs; the line says on what.
const detail = (i: (typeof shown.value)[number]): string =>
  [i.gpu, i.version].filter(Boolean).join(' · ')
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
          @click="hostActions.launch(i)"
        >
          <span v-if="i.kind === 'cloud'" class="mbr-cloud" aria-hidden="true"
            ><Cloud :size="24" :stroke-width="1.6"
          /></span>
          <SetupLaptop v-else :os="localSetup.os" />
          <span class="grid min-w-0 flex-1">
            <span class="mss-machine-kicker"
              ><StatusDot v-if="envStatus(i).live" status="running" />{{ envStatus(i).label }}</span
            >
            <span class="mbr-name">{{ i.name }}</span>
            <span class="mbr-meta">{{ detail(i) }}</span>
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
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 18px;
  padding: 20px 20px 20px 18px;
  border-radius: 16px;
  background:
    radial-gradient(
      ellipse 70% 120% at 12% 0%,
      color-mix(in oklch, var(--color-base-foreground) 8%, transparent),
      transparent 70%
    ),
    oklch(0.6 0 0 / 0.05);
  box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.07);
  text-align: left;
  transition: background-color 0.15s;
}
:root .proto-ui.proto-ui.proto-ui .mbr-card:hover {
  background-color: oklch(0.6 0 0 / 0.1);
}
.mbr-card .mss-laptop {
  width: 88px;
  height: 57px;
}
/* A cloud build has no machine of its own: a screen with the cloud. */
.mbr-cloud {
  display: grid;
  width: 88px;
  height: 57px;
  flex: none;
  place-items: center;
  border-radius: 8px;
  background: linear-gradient(135deg, #3a3a3e, #1f1f22 55%, #0e0e10);
  box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.12);
  color: #d8d8dc;
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
.mbr-meta {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
