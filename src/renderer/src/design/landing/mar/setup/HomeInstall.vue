<script setup lang="ts">
import { computed } from 'vue'
import { Check, LoaderCircle, TriangleAlert } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Checkbox from '../../ui/Checkbox.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import SetupCancelConfirm from './SetupCancelConfirm.vue'
import SetupLaptop from './SetupLaptop.vue'
import ExampleShowcase from '../userStates/ExampleShowcase.vue'
import {
  BUILD_NAME,
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
/** Bare: the card alone, one of the Builds row's cards (MarBuildsRow.vue),
 *  the size of the others; no header, no apps under it. */
const props = defineProps<{ bare?: boolean; wide?: boolean }>()
const size = computed(() => (props.bare ? 'sm' : 'lg'))
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
    return `ComfyUI ${DETECTED.version} · ${flow.movedDisk ? DETECTED.otherPath : DETECTED.path}`
  if (installing.value) return `${phase.value} · ${flow.percent}%`
  if (unsupported.value)
    return 'ComfyUI requires Apple Silicon (M1/M2/M3) Mac. Intel-based Macs are not supported.'
  if (lowSpace.value)
    return `${DETECTED.chip} · ${DETECTED.lowFreeGb} GB free · ~${REQUIRED_GB} GB required`
  return `${DETECTED.chip} · ${DETECTED.memGb} GB memory · ComfyUI ${DETECTED.version} · ${DETECTED.downloadGb} GB download`
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
  <section :class="props.bare ? 'contents' : 'mt-8'" aria-label="Local install">
    <!-- The section is Builds from the first launch: the card under it is
         the first build, waiting to be installed. -->
    <SectionHeader
      v-if="!props.bare"
      class="mar-sec"
      :title="ready ? 'ComfyUI is ready' : 'Builds'"
    />
    <div
      :class="
        props.bare
          ? ['mbr-card mbr-install', props.wide && 'is-wide']
          : 'mss-machine is-hero mss-home-inst'
      "
      :style="props.bare ? { '--h': 48 } : undefined"
      :role="props.bare && ready ? 'button' : undefined"
      :tabindex="props.bare && ready ? 0 : undefined"
      @click="props.bare && ready && openComfyUI()"
      @keydown.enter="props.bare && ready && openComfyUI()"
    >
      <span v-if="props.bare" class="mbr-device">
        <SetupLaptop :os="localSetup.os" :bad="unsupported" />
        <span class="mbr-screen" aria-hidden="true"></span>
      </span>
      <SetupLaptop v-else :os="localSetup.os" :bad="unsupported" />
      <span class="grid min-w-0 flex-1">
        <span class="mss-machine-kicker" :class="state.bad && 'is-bad'"
          ><component
            :is="state.icon"
            :size="state.icon === Check ? 11 : 12"
            :stroke-width="state.icon === Check ? 3 : 2"
            :class="installing && !failed && 'mss-home-spin'"
          />{{ state.label }}</span
        >
        <!-- Named as Builds will list it: the Home already shows the thing
             to launch; the computer is its detail. -->
        <span :class="props.bare ? 'mbr-name' : 'mss-machine-title'">{{
          flow.another ? flow.buildName : BUILD_NAME
        }}</span>
        <span :class="props.bare ? 'mbr-meta' : 'mss-row-meta tabular-nums'">{{ line }}</span>
        <!-- Custom nodes (DESK-243): one quiet line in the card, ticked for a
             new user. Unticked installs plain ComfyUI. -->
        <span v-if="packsOn && !props.bare" class="mss-home-packs">
          <label class="mss-home-packs-pick">
            <Checkbox :model-value="recommended" @update:model-value="choose" />
            <span class="text-base-foreground">Add recommended node packs</span>
            <span class="mss-row-meta tabular-nums">{{
              recommended ? `${flow.packs.length} packs · ${packsMb} MB` : 'Plain ComfyUI'
            }}</span>
          </label>
          <button type="button" class="mss-home-packs-edit" @click="packsFromHome">Edit</button>
        </span>
        <span v-if="installing && !failed" class="mss-home-bar" aria-hidden="true"
          ><span :style="{ width: `${flow.percent}%` }"></span
        ></span>
      </span>
      <span class="flex shrink-0 items-center gap-2">
        <!-- In Builds, ready is a build like any other: Open ComfyUI is
             the Home's, top right, and the card opens it too. -->
        <template v-if="ready && props.bare"></template>
        <template v-else-if="ready">
          <Button variant="ghost" :size="size" @click="dismissReady">Not now</Button>
          <Button variant="primary" :size="size" @click="openComfyUI()">Open ComfyUI</Button>
        </template>
        <template v-else-if="installing">
          <Button variant="ghost" :size="size" @click="showInstall">View logs</Button>
          <Button v-if="failed" variant="secondary" :size="size" @click="changeFromHome"
            >Change</Button
          >
          <Button
            v-if="!failed"
            variant="secondary"
            :size="size"
            @click="flow.confirmCancel = true"
            >{{ props.bare ? 'Cancel' : 'Cancel install' }}</Button
          >
        </template>
        <template v-else>
          <Button v-if="!unsupported" variant="secondary" :size="size" @click="changeFromHome"
            >Change</Button
          >
          <Button v-if="!unsupported" variant="primary" :size="size" @click="install"
            >Install</Button
          >
        </template>
      </span>
    </div>
    <!-- Apps run on Comfy Cloud: the one thing to do before ComfyUI is
         there. The first-run Home's own examples (Milestone 2), in the look
         UI Playground picks; with the Home open they are already there. -->
    <div v-if="!props.bare && !homeOpen && !ready" class="mt-10">
      <ExampleShowcase />
    </div>
    <!-- The install modal carries its own confirm while it is open. -->
    <SetupCancelConfirm v-if="!flow.open" />
  </section>
</template>

<style scoped>
/* With two other builds beside it the row is too tight for its actions:
 * it takes the first line on its own, the others go under. */
.mbr-install.is-wide {
  grid-column: 1 / -1;
}
/* One of the Builds row's cards, the height of the others whatever its
 * state: the actions stay on the right, small, and the bar is a line along
 * the card's bottom edge instead of a row of its own. */
.mbr-install .mss-home-bar {
  position: absolute;
  inset: auto 0 0 0;
  height: 3px;
  max-width: none;
  margin-top: 0;
  border-radius: 0;
}
.mss-home-builds {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  align-items: stretch;
  gap: 8px;
  margin-top: 8px;
}
.mss-home-packs {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 14px;
  font-size: 13px;
}
.mss-home-packs-pick {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
:root .proto-ui.proto-ui.proto-ui .mss-home-packs-edit {
  padding: 2px 6px;
  border-radius: 6px;
  background: transparent;
  color: var(--color-subtle-foreground);
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 3px;
}
:root .proto-ui.proto-ui.proto-ui .mss-home-packs-edit:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mss-home-packs [role='checkbox'][data-state='checked'] {
  border-color: var(--color-inverted-background);
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
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
  height: 4px;
  max-width: 440px;
  margin-top: 12px;
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
