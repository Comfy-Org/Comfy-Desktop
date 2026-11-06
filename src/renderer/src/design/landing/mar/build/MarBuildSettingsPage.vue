<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Cloud, Laptop, Server } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import { go, type Page } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import MarEntityHeader from '../pages/MarEntityHeader.vue'
import MarSeg from '../pages/MarSeg.vue'
import { marTabsOn } from '../shell/titleTabs'
import BuildAbout from './BuildAbout.vue'
import BuildArgs from './BuildArgs.vue'
import BuildOp from './BuildOp.vue'
import BuildSnapshots from './BuildSnapshots.vue'
import BuildStorage from './BuildStorage.vue'
import BuildTerminal from './BuildTerminal.vue'
import BuildUpdate from './BuildUpdate.vue'
import { stateOf } from './buildFacts'
import { opOf } from './buildOps'
import { desktopTabs, nextBuildTab, type BuildTab } from './buildTab'
import { isRemote } from './m1Builds'

/**
 * A build's Settings page, past the Builds milestone (UI Playground › Sync
 * with previous versions): the Builds milestone's tabs as they are, on
 * their own page, so the build's page keeps its one row of tabs. The title
 * bar's breadcrumb says where it sits and leads back to the build. Long
 * work runs inside the tab (buildOps.ts).
 */
const { env } = defineProps<{ env: ProtoInstance }>()

const state = stateOf(env)
const remote = isRemote(env)
const own = env.kind === 'local'
const op = computed(() => opOf(env.id))
const TABS = computed(() => desktopTabs(own, remote))

const asked = nextBuildTab.value
nextBuildTab.value = ''
const tab = ref<BuildTab>(
  TABS.value.some((t) => t.value === asked) ? (asked as BuildTab) : TABS.value[0]!.value
)
watch(TABS, (list) => {
  if (!list.some((t) => t.value === tab.value)) tab.value = list[0]!.value
})
</script>

<template>
  <div class="mar-bp mx-auto w-full max-w-440 px-11 pb-24">
    <MarEntityHeader
      :back="marTabsOn ? env.name : undefined"
      title="Settings"
      @back="go(`environment:${env.id}` as Page)"
    >
      <template #meta>
        <span class="text-base-foreground">{{ env.name }}</span>
        <Badge v-if="!remote" size="sm">{{ state.version }}</Badge>
        <span class="mar-eh-dot" />
        <span class="inline-flex items-center gap-1.5">
          <component :is="remote ? Server : own ? Laptop : Cloud" :size="13" />{{
            remote ? 'Remote' : own ? 'This computer' : 'Comfy Cloud'
          }}
        </span>
      </template>
    </MarEntityHeader>

    <div class="mar-bp-row">
      <MarSeg v-if="TABS.length > 1" v-model="tab" :options="TABS" label="In these settings" />
    </div>

    <!-- A long operation takes the tab's place until it settles. -->
    <BuildOp v-if="op" :id="env.id" :op :name="env.name" />
    <BuildUpdate v-else-if="tab === 'update'" :env />
    <BuildArgs v-else-if="tab === 'args'" :env />
    <BuildSnapshots v-else-if="tab === 'snapshots'" :env />
    <BuildStorage v-else-if="tab === 'storage'" :env />
    <BuildTerminal v-else-if="tab === 'terminal'" :env />
    <BuildAbout v-else-if="tab === 'about'" :env />
  </div>
</template>
