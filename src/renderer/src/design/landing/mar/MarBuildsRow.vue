<script setup lang="ts">
import { computed } from 'vue'
import { Plus } from 'lucide-vue-next'
import Card from '../ui/Card.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import StatusDot from '../ui/StatusDot.vue'
import LocationIcon from '../ui/LocationIcon.vue'
import { envStatus } from '../parts/env/env'
import { go, hostActions, instances, recentInstances } from '../useProto'
import { can } from '../milestones'
import SetupLaptop from './setup/SetupLaptop.vue'
import SetupCloud from './setup/SetupCloud.vue'
import HomeInstall from './setup/HomeInstall.vue'
import { cardInBuilds, flow, installPending, localSetup } from './setup/setupFlow'
import BuildTile from './build/BuildTile.vue'
import { instanceMenu } from './build/buildMenu'
import {
  autoStart,
  hasUpdate,
  nowOf,
  runs,
  startBuild,
  uninstalled,
  viewLogs
} from './build/homeRun'
import type { ProtoInstance } from '../mock'
import './setup/setup.css'

/** Home's builds in Mar's proposal (UI Playground › Build on Home): what
 *  Pablo's Home shows (three recent builds, their state, click to launch
 *  ComfyUI on one), as one row of cards like Spaces. */
// With the install card in this section (setup/HomeInstall.vue, bare) the
// local build is that card, large, until ComfyUI is opened: not listed twice.
const shown = computed(() =>
  recentInstances.value
    .filter((i) => !uninstalled.has(i.id))
    .filter((i) => !(cardInBuilds.value && !flow.another && i.kind === 'local'))
    // Three cards at most, the one installing first among them.
    .slice(0, cardInBuilds.value ? 2 : 3)
)
/** From Milestone 2 on, each build is the install card made small:
 *  the machine drawn, its state, its name, what it runs on. Each one is
 *  its own, lit in the build's hue. */
const machine = computed(() => can.value.exploreApps)
// The drawing says where it runs; the line says on what.
const detail = (i: ProtoInstance): string => [i.gpu, i.version].filter(Boolean).join(' · ')
const RUN_LABEL = { start: 'Starting ComfyUI', update: 'Updating', uninstall: 'Uninstalling' }
// In progress, a tile says what and how far, and the version under the name.
function status(i: ProtoInstance): { label: string; live?: boolean; busy?: boolean } {
  const run = runs.get(i.id)
  if (run)
    return {
      label: `${RUN_LABEL[run.kind]} · ${run.percent}%`,
      busy: true
    }
  if (nowOf(i) === 'running') return { label: 'Running', live: true }
  // A build that isn't running is ready to: the Home starts, it doesn't
  // manage, so no "Stopped" here. The status always says what it does;
  // an update waiting is a grey note on the bottom line (Comfy-Desktop#2163).
  if (i.kind === 'local') return { label: autoStart.id === i.id ? 'Auto start' : 'Ready' }
  const s = envStatus(i)
  return { label: s.label, live: s.live }
}
const meta = (i: ProtoInstance): string =>
  runs.has(i.id) ? `ComfyUI ${i.version ?? ''}`.trim() : detail(i)
const note = (i: ProtoInstance): string | undefined =>
  !runs.has(i.id) && i.kind === 'local' && hasUpdate(i) ? 'Update' : undefined
// The whole tile is the action: a click starts it, opens it when it runs,
// shows the logs while it is busy. The hover hint names it.
function hint(i: ProtoInstance): string {
  const run = runs.get(i.id)
  if (run) return run.kind === 'uninstall' ? '' : 'Click to view logs'
  return nowOf(i) === 'running' || i.kind !== 'local' ? 'Click to open' : 'Click to start'
}
function open(i: ProtoInstance): void {
  const run = runs.get(i.id)
  if (run?.kind === 'start' || run?.kind === 'update') viewLogs(i)
  else if (!run) startBuild(i)
}
// No build on this computer (all uninstalled, or Cloud only): the row ends
// in a New build tile, the same size as the others, the whole tile the
// action (Comfy-Desktop#2180). It goes once a local build exists.
const offerNew = computed(
  () =>
    machine.value &&
    !cardInBuilds.value &&
    !installPending.value &&
    !instances.value.some((i) => i.kind === 'local' && !uninstalled.has(i.id))
)
const count = computed(() =>
  Math.min(3, shown.value.length + (cardInBuilds.value || offerNew.value ? 1 : 0))
)
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
    <!-- One, two or three builds fill the row; narrow, one per row. -->
    <div class="mbr-row">
      <div class="mbr-grid" :class="`is-${count}`">
        <!-- Home first: the first build, installing or ready, is the first card. -->
        <HomeInstall v-if="cardInBuilds" bare />
        <template v-if="machine">
          <BuildTile
            v-for="i in shown"
            :key="i.id"
            :hue="i.hue"
            :name="i.name"
            :meta="meta(i)"
            :note="note(i)"
            :hint="hint(i)"
            :status="status(i)"
            :percent="runs.get(i.id)?.percent ?? null"
            :openable="runs.get(i.id)?.kind !== 'uninstall'"
            :lines="instanceMenu(i)"
            @open="open(i)"
          >
            <template #device>
              <SetupCloud v-if="i.kind === 'cloud'" :hue="i.hue" />
              <template v-else>
                <SetupLaptop :os="localSetup.os" />
                <!-- The build's hue on its screen. -->
                <span class="mbr-screen" aria-hidden="true"></span>
              </template>
            </template>
          </BuildTile>
          <button
            v-if="offerNew"
            type="button"
            class="mbr-card mbr-tile mbr-new"
            style="--h: 220"
            @click="hostActions.newInstance()"
          >
            <span class="mbr-device"
              ><span class="mbr-new-plus"><Plus :size="18" /></span
            ></span>
            <span class="mbr-text grid min-w-0 flex-1">
              <span class="mbr-name">New build</span>
              <span class="mbr-meta">Run ComfyUI on this computer</span>
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
    </div>
  </section>
</template>

<style>
/* The New build tile: a grey round plus where the machine goes. */
.mbr-new {
  text-align: left;
}
.mbr-new .mbr-device {
  display: grid;
  place-items: center;
}
.mbr-new-plus {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-muted-foreground);
  transition: background-color 150ms ease;
}
.mbr-new:hover .mbr-new-plus {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  color: var(--color-base-foreground);
}
</style>
