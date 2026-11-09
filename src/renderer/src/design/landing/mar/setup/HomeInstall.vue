<script setup lang="ts">
import { computed } from 'vue'
import { Check, LoaderCircle, TriangleAlert } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import SetupCancelConfirm from './SetupCancelConfirm.vue'
import SetupLaptop from './SetupLaptop.vue'
import StarterShelf from './StarterShelf.vue'
import ExampleRow from '../userStates/ExampleRow.vue'
import { go } from '../../useProto'
import { can } from '../../milestones'
import {
  DETECTED,
  changeFromHome,
  flow,
  homeOpen,
  installInBackground,
  localSetup,
  lowSpace,
  phaseIndex,
  phases,
  showInstall,
  unsupported
} from './setupFlow'

/**
 * Home first (UI Playground › Local setup › Onboarding): the first launch
 * lands on the Home, and the install waits here on one card: what was
 * detected, Install, and Change for the two things that can be wrong (where
 * it goes, which hardware). Once it runs, the card carries today's progress,
 * the logs and Cancel, and the wait is for picking the workflow to open
 * first; its models join the install as the last step, as in today's
 * Workflow step. The card is Set up's own: the computer drawn large, as the
 * subject. Under it, the apps: they run on Comfy Cloud, so they work before
 * ComfyUI is installed (Milestone 2).
 */
const failed = computed(() => flow.step === 'error')
const installing = computed(() => flow.background && (flow.running || failed.value))
const blocked = computed(() => lowSpace.value || unsupported.value)
// The card's kicker says where it stands; what stops the install before it
// starts keeps today's words (Set up).
const state = computed(() => {
  if (failed.value) return { label: 'Operation failed', icon: TriangleAlert, bad: true }
  if (installing.value) return { label: 'Installing ComfyUI', icon: LoaderCircle, bad: false }
  if (unsupported.value) return { label: 'Unsupported Hardware', icon: TriangleAlert, bad: true }
  if (lowSpace.value) return { label: 'Low Disk Space', icon: TriangleAlert, bad: true }
  return { label: 'Detected', icon: Check, bad: false }
})
const phase = computed(() => phases.value[Math.max(0, phaseIndex.value)]?.label ?? '')
const REQUIRED_GB = (DETECTED.downloadGb * 2.25).toFixed(1)
const line = computed(() => {
  if (installing.value) return `${phase.value} · ${flow.percent}%`
  if (unsupported.value)
    return 'ComfyUI requires Apple Silicon (M1/M2/M3) Mac. Intel-based Macs are not supported.'
  if (lowSpace.value) return `${DETECTED.lowFreeGb} GB free · ~${REQUIRED_GB} GB required`
  return `${DETECTED.memGb} GB memory · ComfyUI ${DETECTED.version} · ${DETECTED.downloadGb} GB download`
})
// Pick to install: the workflows show before the install too, and picking a
// local one starts it (StarterShelf.vue).
const shelf = computed(
  () => !failed.value && (installing.value || (homeOpen.value && !unsupported.value))
)
// No space: Change setup is where another disk is picked.
const install = (): void => (blocked.value ? changeFromHome() : installInBackground())
</script>

<template>
  <section class="mt-8" aria-label="Local install">
    <SectionHeader v-if="!installing" :title="`Install ComfyUI on ${DETECTED.noun}`" />
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
        <template v-if="installing">
          <Button variant="ghost" @click="showInstall">View logs</Button>
          <Button v-if="failed" variant="ghost" @click="changeFromHome">Change</Button>
          <Button v-if="!failed" variant="ghost" @click="flow.confirmCancel = true"
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
    <!-- Apps run on Comfy Cloud: the one thing to do before ComfyUI is
         there, so they come first. -->
    <div class="mt-10">
      <SectionHeader
        title="Apps"
        :link="can.exploreApps ? 'See all' : undefined"
        @link="go(can.explore ? 'explore' : 'overview')"
      >
        <template #controls>
          <span class="text-ui text-subtle-foreground">Run on Comfy Cloud, no install needed</span>
        </template>
      </SectionHeader>
      <ExampleRow />
    </div>
    <div v-if="shelf" class="mt-10">
      <SectionHeader title="Start from a workflow">
        <template v-if="installing" #controls>
          <span class="text-ui text-subtle-foreground"
            >Pick one; it opens when ComfyUI is ready</span
          >
        </template>
      </SectionHeader>
      <StarterShelf />
    </div>
    <!-- The install modal carries its own confirm while it is open. -->
    <SetupCancelConfirm v-if="!flow.open" />
  </section>
</template>

<style scoped>
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
