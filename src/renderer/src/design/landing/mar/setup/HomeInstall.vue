<script setup lang="ts">
import { computed } from 'vue'
import { Check, LoaderCircle, TriangleAlert } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import SetupCancelConfirm from './SetupCancelConfirm.vue'
import SetupLaptop from './SetupLaptop.vue'
import ExampleShowcase from '../userStates/ExampleShowcase.vue'
import {
  DETECTED,
  changeFromHome,
  dismissReady,
  flow,
  homeOpen,
  installInBackground,
  localSetup,
  lowSpace,
  nodesOnHome,
  openComfyUI,
  packsFromHome,
  packsMb,
  phaseIndex,
  phases,
  recommendedPacks,
  showInstall,
  unsupported
} from './setupFlow'

/**
 * Home first (UI Playground › Local setup › Onboarding): the first launch
 * lands on the Home, and the install waits here on one card: what was
 * detected, Install, and Change for the two things that can be wrong (where
 * it goes, which hardware). Once it runs, the card carries today's progress,
 * the logs and Cancel. The card is Set up's own: the computer drawn large, as the
 * subject. Under it, the apps: they run on Comfy Cloud, so they work before
 * ComfyUI is installed (Milestone 2).
 */
const failed = computed(() => flow.step === 'error')
const installing = computed(() => flow.background && (flow.running || failed.value))
// After install › Ready: the same card says ComfyUI is there, with the one
// way in. Any Local setup flow ends here when that option is on.
const ready = computed(() => flow.ready)
const blocked = computed(() => lowSpace.value || unsupported.value)
// The card's kicker says where it stands; what stops the install before it
// starts keeps today's words (Set up).
const state = computed(() => {
  if (ready.value) return { label: 'Ready', icon: Check, bad: false }
  if (failed.value) return { label: 'Operation failed', icon: TriangleAlert, bad: true }
  if (installing.value) return { label: 'Installing ComfyUI', icon: LoaderCircle, bad: false }
  if (unsupported.value) return { label: 'Unsupported Hardware', icon: TriangleAlert, bad: true }
  if (lowSpace.value) return { label: 'Low Disk Space', icon: TriangleAlert, bad: true }
  return { label: 'Detected', icon: Check, bad: false }
})
const phase = computed(() => phases.value[Math.max(0, phaseIndex.value)]?.label ?? '')
const REQUIRED_GB = (DETECTED.downloadGb * 2.25).toFixed(1)
const line = computed(() => {
  if (ready.value)
    return `ComfyUI ${DETECTED.version} installed · ${flow.movedDisk ? DETECTED.otherPath : DETECTED.path}`
  if (installing.value) return `${phase.value} · ${flow.percent}%`
  if (unsupported.value)
    return 'ComfyUI requires Apple Silicon (M1/M2/M3) Mac. Intel-based Macs are not supported.'
  if (lowSpace.value) return `${DETECTED.lowFreeGb} GB free · ~${REQUIRED_GB} GB required`
  return `${DETECTED.memGb} GB memory · ComfyUI ${DETECTED.version} · ${DETECTED.downloadGb} GB download`
})
// Custom nodes (DESK-243): the Recommended build, ComfyUI with the most used
// node packs, or plain ComfyUI. Picked before Install; Edit packs opens the
// list.
const packsOn = computed(
  () => nodesOnHome.value && !installing.value && !ready.value && !unsupported.value
)
const recommended = computed(() => flow.packs.length > 0)
function choose(v: boolean): void {
  flow.packs = v ? recommendedPacks() : []
}
// No space: Change setup is where another disk is picked.
const install = (): void => (blocked.value ? changeFromHome() : installInBackground())
</script>

<template>
  <section class="mt-8" aria-label="Local install">
    <SectionHeader
      v-if="!installing"
      :title="ready ? 'ComfyUI is ready' : `Install ComfyUI on ${DETECTED.noun}`"
    />
    <div class="mss-machine is-hero mss-home-inst">
      <SetupLaptop :os="localSetup.os" :bad="unsupported" />
      <span class="grid min-w-0 flex-1">
        <span class="mss-machine-kicker" :class="state.bad && 'is-bad'"
          ><component
            :is="state.icon"
            :size="state.icon === Check ? 11 : 12"
            :stroke-width="state.icon === Check ? 3 : 2"
            :class="installing && !failed && 'mss-home-spin'"
          />{{ state.label }}</span
        >
        <span class="mss-machine-title">{{ DETECTED.chip }}</span>
        <span class="mss-row-meta tabular-nums">{{ line }}</span>
        <span v-if="installing && !failed" class="mss-home-bar" aria-hidden="true"
          ><span :style="{ width: `${flow.percent}%` }"></span
        ></span>
      </span>
      <span class="flex shrink-0 items-center gap-2">
        <template v-if="ready">
          <Button variant="ghost" size="lg" @click="dismissReady">Not now</Button>
          <Button variant="primary" size="lg" @click="openComfyUI()">Open ComfyUI</Button>
        </template>
        <template v-else-if="installing">
          <Button variant="ghost" @click="showInstall">View logs</Button>
          <Button v-if="failed" variant="secondary" @click="changeFromHome">Change</Button>
          <Button v-if="!failed" variant="secondary" @click="flow.confirmCancel = true"
            >Cancel install</Button
          >
        </template>
        <template v-else>
          <Button v-if="!unsupported" variant="secondary" size="lg" @click="changeFromHome"
            >Change</Button
          >
          <Button v-if="!unsupported" variant="primary" size="lg" @click="install">Install</Button>
        </template>
      </span>
    </div>
    <div
      v-if="packsOn"
      class="mss-home-builds"
      role="radiogroup"
      aria-label="What to install"
      data-no-pill
    >
      <button
        type="button"
        role="radio"
        :aria-checked="recommended"
        class="mss-home-build"
        @click="choose(true)"
      >
        <span class="mss-home-build-dot" aria-hidden="true"></span>
        <span class="grid min-w-0">
          <span class="mss-home-build-title"
            >Recommended build<span class="mss-home-build-tag">For new users</span></span
          >
          <span class="mss-row-meta tabular-nums">{{
            recommended
              ? `ComfyUI + ${flow.packs.length} popular node packs · ${packsMb} MB`
              : 'ComfyUI + the most used node packs'
          }}</span>
        </span>
      </button>
      <button
        type="button"
        role="radio"
        :aria-checked="!recommended"
        class="mss-home-build"
        @click="choose(false)"
      >
        <span class="mss-home-build-dot" aria-hidden="true"></span>
        <span class="grid min-w-0">
          <span class="mss-home-build-title">Plain ComfyUI</span>
          <span class="mss-row-meta">Nothing added. Add node packs later from the Manager.</span>
        </span>
      </button>
      <button type="button" class="mss-home-build-edit" @click="packsFromHome">Edit packs</button>
    </div>
    <!-- Apps run on Comfy Cloud: the one thing to do before ComfyUI is
         there. The first-run Home's own examples (Milestone 2), in the look
         UI Playground picks; with the Home open they are already there. -->
    <div v-if="!homeOpen && !ready" class="mt-10">
      <ExampleShowcase />
    </div>
    <!-- The install modal carries its own confirm while it is open. -->
    <SetupCancelConfirm v-if="!flow.open" />
  </section>
</template>

<style scoped>
.mss-home-builds {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  align-items: stretch;
  gap: 8px;
  margin-top: 8px;
}
:root .proto-ui.proto-ui.proto-ui .mss-home-build {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  border-radius: 12px;
  background: transparent;
  text-align: left;
  transition:
    border-color 0.15s,
    background-color 0.15s;
}
:root .proto-ui.proto-ui.proto-ui .mss-home-build:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mss-home-build[aria-checked='true'] {
  border-color: var(--color-base-foreground);
}
.mss-home-build-dot {
  width: 14px;
  height: 14px;
  flex: none;
  margin-top: 2px;
  border: 1.5px solid color-mix(in oklch, var(--color-base-foreground) 35%, transparent);
  border-radius: 999px;
}
.mss-home-build[aria-checked='true'] .mss-home-build-dot {
  border: 4px solid var(--color-base-foreground);
}
.mss-home-build-title {
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
}
.mss-home-build-tag {
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .mss-home-build-edit {
  align-self: center;
  padding: 6px 10px;
  border-radius: 8px;
  background: transparent;
  color: var(--color-subtle-foreground);
  font-size: 13px;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .mss-home-build-edit:hover {
  color: var(--color-base-foreground);
}
@media (max-width: 720px) {
  .mss-home-builds {
    grid-template-columns: 1fr;
  }
}
.mss-machine-kicker.is-bad {
  color: var(--color-status-danger);
}
.mss-home-spin {
  animation: mss-home-spin 1s linear infinite;
}
@keyframes mss-home-spin {
  to {
    transform: rotate(360deg);
  }
}
.mss-home-bar {
  display: block;
  height: 3px;
  max-width: 420px;
  margin-top: 10px;
  overflow: hidden;
  border-radius: 2px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mss-home-bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-base-foreground);
  transition: width 180ms linear;
}
@media (prefers-reduced-motion: reduce) {
  .mss-home-bar > span {
    transition: none;
  }
  .mss-home-spin {
    animation: none;
  }
}
</style>
