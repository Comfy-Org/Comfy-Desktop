<script setup lang="ts">
import { computed } from 'vue'
import StartPaths from '../../parts/StartPaths.vue'
import Greeting from '../../parts/Greeting.vue'
import PromptBox from '../../parts/PromptBox.vue'
import LaunchesRow from '../../parts/LaunchesRow.vue'
import QuickLaunch from '../../parts/QuickLaunch.vue'
import RecentWork from '../../parts/RecentWork.vue'
import TemplatesRow from '../../parts/TemplatesRow.vue'
import SpacesRow from '../../parts/space/SpacesRow.vue'
import { Play, Rocket } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { activeInstance, deployEnv, hostActions, instances, proto } from '../../useProto'
import { can } from '../../milestones'

/**
 * Home (Milestone 4). First run: example workflows to run and where to run
 * them (Comfy Cloud or this computer). Returning: open ComfyUI in a recent
 * build, example workflows, and what you used recently. What's new joins
 * with Explore (Milestone 5); the agent's prompt box with Agent (10).
 */
// ComfyUI always; Deploy with the Builder, once there's a build to deploy.
const actions = computed(() => [
  {
    label: 'ComfyUI',
    icon: Play,
    run: () => hostActions.launch(activeInstance.value)
  },
  ...(can.value.builder &&
  proto.signedIn &&
  instances.value.some((i) => !i.deployment && i.kind === 'local')
    ? [
        {
          label: 'Deploy',
          icon: Rocket,
          run: () =>
            deployEnv(
              (activeInstance.value.kind === 'local'
                ? activeInstance.value
                : instances.value.find((i) => i.kind === 'local')!
              ).id
            )
        }
      ]
    : [])
])
const noLocal = computed(() => !instances.value.some((i) => i.kind === 'local'))
</script>

<template>
  <!-- Quick actions, top right (Spline style). -->
  <div class="absolute top-3.5 right-4 z-10 flex items-center gap-2">
    <Button v-for="a in actions" :key="a.label" @click="a.run()">
      <component :is="a.icon" :size="14" />{{ a.label }}
    </Button>
  </div>
  <div :class="['mx-auto w-full max-w-300 px-10', noLocal ? 'h-full overflow-hidden' : 'pb-16']">
    <!-- New users get the setup choice, centred on a full screen. -->
    <section :class="['flex flex-col', noLocal ? 'h-full' : 'pt-12 pb-4']">
      <div class="flex flex-1 flex-col justify-center pt-10">
        <StartPaths v-if="noLocal" />
        <template v-else>
          <Greeting />
          <PromptBox v-if="can.agent" target />
          <QuickLaunch />
        </template>
      </div>
    </section>
    <div v-if="!noLocal">
      <TemplatesRow title="Example workflows" class="mt-0!" />
      <RecentWork />
      <LaunchesRow v-if="can.explore" />
      <SpacesRow v-if="can.spaces && proto.signedIn" />
    </div>
  </div>
  <!-- Fade at the bottom of the screen: content continues below. -->
  <div
    v-if="!noLocal"
    aria-hidden="true"
    class="pointer-events-none sticky bottom-0 -mt-32 h-32 bg-[linear-gradient(to_top,var(--color-content-background)_15%,transparent)]"
  />
</template>
