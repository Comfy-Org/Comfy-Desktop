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
import HomeInstall from './setup/HomeInstall.vue'
import { cardInBuilds, flow, localSetup } from './setup/setupFlow'
import './setup/setup.css'

/** Home's builds in Mar's proposal (UI Playground › Build on Home): what
 *  Pablo's Home shows (three recent builds, their state, click to launch
 *  ComfyUI on one), as one row of cards like Spaces. */
// With the install card in this section (setup/HomeInstall.vue, bare) the
// local build is that card, large, until ComfyUI is opened: not listed twice.
const shown = computed(() =>
  recentInstances.value
    .filter((i) => !(cardInBuilds.value && !flow.another && i.kind === 'local'))
    // Three cards at most, the one installing first among them.
    .slice(0, cardInBuilds.value ? 2 : 3)
)
/** From Milestone 2 on, each build is the install card made small:
 *  the machine drawn, its state, its name, what it runs on. Each one is
 *  its own, lit in the build's hue. */
const machine = computed(() => can.value.exploreApps)
// The drawing says where it runs; the line says on what.
const detail = (i: (typeof shown.value)[number]): string =>
  [i.gpu, i.version].filter(Boolean).join(' · ')
</script>

<template>
  <section class="mt-10">
    <!-- All builds only once the row can't show them all. -->
    <SectionHeader
      class="mar-sec"
      title="Builds"
      :link="recentInstances.length > shown.length ? 'All builds' : undefined"
      @link="go('environments')"
    />
    <!-- One, two or three builds always fill the row. -->
    <div
      class="grid gap-3.5"
      :style="{
        gridTemplateColumns: `repeat(${shown.length + (cardInBuilds ? 1 : 0)}, minmax(0, 1fr))`
      }"
    >
      <!-- Home first: the first build, installing or ready, is the first card. -->
      <HomeInstall v-if="cardInBuilds" bare :narrow="shown.length >= 2" />
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
            <!-- A build that isn't running is ready to: the Home launches,
                 it doesn't manage, so no "Stopped" here. -->
            <span class="mss-machine-kicker"
              ><StatusDot v-if="envStatus(i).live" status="running" />{{
                envStatus(i).label === 'Stopped' ? 'Ready' : envStatus(i).label
              }}</span
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
