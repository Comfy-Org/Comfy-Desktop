<script setup lang="ts">
import { computed } from 'vue'
import { Loader2, TriangleAlert } from 'lucide-vue-next'
import Button from '../ui/Button.vue'
import InstanceGlyph from './InstanceGlyph.vue'
import { closeTab, instanceById, proto } from '../useProto'
import { buildState } from '../buildTabs'
import MarGraph from '../mar/graph/MarGraph.vue'
import MarCloudBar from '../mar/shell/MarCloudBar.vue'
import { onCloud } from '../mar/shell/surface'
import PreparingTab from '../mar/templateOpen/PreparingTab.vue'
import { prepOfTab } from '../mar/templateOpen/prepTabs'
import StartingTab from '../mar/build/StartingTab.vue'
import { repairs, runs } from '../mar/build/homeRun'
import { START_COPY, startFailures } from '../mar/build/comfyStart'

/**
 * A build's tab, under its ComfyUI. In the app with your real builds, main
 * shows that build's ComfyUI over this once it runs; this says what's
 * happening until then. Mock builds (and the browser preview) have no
 * ComfyUI to show.
 */
const tab = computed(() => proto.tabs.find((t) => t.id === proto.activeTab))
const inst = computed(() => (tab.value ? instanceById(tab.value.instanceId) : undefined))
const state = computed(() => (inst.value ? buildState[inst.value.id] : undefined))
const real = computed(() => proto.live && !!inst.value?.source)
const prep = computed(() => (tab.value ? prepOfTab(tab.value.id) : undefined))
const starting = computed(
  () =>
    !!inst.value &&
    !real.value &&
    (runs.get(inst.value.id)?.kind === 'start' ||
      startFailures.has(inst.value.id) ||
      repairs.has(inst.value.id))
)
</script>

<template>
  <!-- On Comfy Cloud the browser bar stays, with its way back to Home
       (mar/shell). -->
  <MarCloudBar v-if="onCloud" />
  <!-- A mock of ComfyUI's graph editor (mar/graph). -->
  <PreparingTab v-if="prep && !prep.ready" :prep="prep" />
  <StartingTab v-else-if="starting && inst" :inst="inst" />
  <MarGraph
    v-else-if="tab && inst && !real && state?.kind !== 'error'"
    :workflow="tab.workflow === 'Untitled workflow' ? undefined : tab.workflow"
  />
  <div
    v-else-if="tab && inst"
    class="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center"
  >
    <InstanceGlyph :inst="inst" size="lg" />
    <template v-if="state?.kind === 'error'">
      <p class="flex items-center gap-2 text-body font-medium">
        <TriangleAlert :size="15" class="text-status-danger" />{{ START_COPY.failedTitle }}
      </p>
      <p class="max-w-md text-ui text-muted-foreground">{{ state.message }}</p>
      <Button variant="secondary" size="sm" @click="closeTab(tab.id)">Close tab</Button>
    </template>
    <template v-else-if="real">
      <p class="flex items-center gap-2 text-body font-medium">
        <Loader2 :size="15" class="animate-spin" />{{ START_COPY.title }}
      </p>
      <p class="text-ui text-muted-foreground">{{ inst.name }}</p>
    </template>
    <template v-else>
      <p class="text-body font-medium">{{ inst.name }}</p>
      <p class="max-w-md text-ui text-muted-foreground">
        ComfyUI opens here. Turn on Data: Mine in the app to open your real builds.
      </p>
    </template>
  </div>
</template>
