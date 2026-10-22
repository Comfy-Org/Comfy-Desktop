<script setup lang="ts">
import { computed } from 'vue'
import { Loader2, TriangleAlert } from 'lucide-vue-next'
import Button from '../ui/Button.vue'
import InstanceGlyph from './InstanceGlyph.vue'
import { closeTab, instanceById, proto } from '../useProto'
import { buildState } from '../buildTabs'

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
</script>

<template>
  <div
    v-if="tab && inst"
    class="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center"
  >
    <InstanceGlyph :inst="inst" size="lg" />
    <template v-if="state?.kind === 'error'">
      <p class="flex items-center gap-2 text-body font-medium">
        <TriangleAlert :size="15" class="text-status-danger" />{{ inst.name }} couldn't start
      </p>
      <p class="max-w-md text-ui text-muted-foreground">{{ state.message }}</p>
      <Button variant="secondary" size="sm" @click="closeTab(tab.id)">Close tab</Button>
    </template>
    <template v-else-if="real">
      <p class="flex items-center gap-2 text-body font-medium">
        <Loader2 :size="15" class="animate-spin" />Starting {{ inst.name }}
      </p>
      <p class="text-ui text-muted-foreground">ComfyUI opens here when it's ready.</p>
    </template>
    <template v-else>
      <p class="text-body font-medium">{{ inst.name }}</p>
      <p class="max-w-md text-ui text-muted-foreground">
        ComfyUI opens here. Turn on Data: Mine in the app to open your real builds.
      </p>
    </template>
  </div>
</template>
