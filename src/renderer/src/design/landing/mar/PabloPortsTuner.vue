<script setup lang="ts">
import { computed } from 'vue'
import Switch from '../ui/Switch.vue'
import { isNewUser, proto } from '../useProto'
import { PORTS, ports, type Port } from './pabloPorts'
import { marNav, marSideOn } from './shell/marShell'

/** UI Playground › From Pablo: one switch per feature of Pablo's that
 *  Mar's proposal now has a version of. All Off by default. A switch only
 *  shows while flipping it changes what's on screen: they act on the
 *  Floating sidebar and the Tabs bar, each in its own situation. */
const onNav = computed(() => marSideOn.value || marNav.id === 'tabs')
const WHEN: Record<Port, () => boolean> = {
  navAccount: () => !proto.signedIn,
  navDocs: () => proto.mode === 'build',
  firstRunNav: () => isNewUser.value
}
const shown = computed(() => (onNav.value ? PORTS.filter((p) => WHEN[p.key]()) : []))
</script>

<template>
  <div v-if="shown.length" class="flex flex-col gap-2">
    <span class="text-ui text-subtle-foreground">From Pablo</span>
    <Switch v-for="p in shown" :key="p.key" v-model="ports[p.key]" :label="p.label" />
  </div>
</template>
