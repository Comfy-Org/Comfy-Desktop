<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ExternalLink, Rocket, UserPlus } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import StatusDot from '../../ui/StatusDot.vue'
import Tabs from '../../ui/Tabs.vue'
import MembersTable from '../../parts/space/MembersTable.vue'
import SpaceMark from '../../parts/space/SpaceMark.vue'
import SpaceActivity from './SpaceActivity.vue'
import SpaceCatalog from './SpaceCatalog.vue'
import SpaceHomeBrand from './SpaceHomeBrand.vue'
import SpaceAccess from './SpaceAccess.vue'
import SpaceOverview from './SpaceOverview.vue'
import SpaceSettings from './SpaceSettings.vue'
import SpaceUsage from './SpaceUsage.vue'
import { goLive, type Space } from '../../spaces'
import { go, toast } from '../../useProto'

/** Studio view of one space: everything the studio controls. */
const { space } = defineProps<{ space: Space }>()
type Tab = 'overview' | 'catalog' | 'home' | 'members' | 'usage' | 'activity' | 'settings'
const tab = ref<Tab>('overview')
const members = ref<InstanceType<typeof MembersTable>>()
const tabs = computed(() => [
  { value: 'overview' as Tab, label: 'Overview' },
  { value: 'catalog' as Tab, label: 'Published tools', count: space.catalog.length },
  { value: 'home' as Tab, label: 'Home & brand' },
  { value: 'members' as Tab, label: 'Members', count: space.members.length },
  { value: 'usage' as Tab, label: 'Usage & billing' },
  { value: 'activity' as Tab, label: 'Activity' },
  { value: 'settings' as Tab, label: 'Settings' }
])
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <Button variant="link" size="sm" class="mt-6 -mb-4" @click="go('spaces')"
      ><ChevronLeft :size="14" />Spaces</Button
    >
    <header class="flex items-start gap-4 pt-12 pb-8">
      <SpaceMark :brand="space.brand" size="lg" />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2.5">
          <h1 class="text-title font-semibold tracking-[-0.01em]">{{ space.name }}</h1>
          <Badge size="md" class="capitalize"
            ><StatusDot :status="space.status === 'live' ? 'running' : 'idle'" />{{
              space.status
            }}</Badge
          >
        </div>
        <p class="mt-1 flex items-center gap-2 text-ui text-muted-foreground">
          <button
            type="button"
            class="inline-flex items-center gap-1 hover:text-base-foreground"
            @click="toast(`Opening ${space.domain} ↗`)"
          >
            {{ space.domain }}<ExternalLink :size="12" />
          </button>
          <span class="text-subtle-foreground"
            >· {{ space.catalog.length }} tools on {{ space.catalog.length }} endpoints</span
          >
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button size="lg" @click="((tab = 'members'), members?.invite())"
          ><UserPlus :size="14" />Invite</Button
        >
        <Button
          v-if="space.status === 'draft'"
          variant="primary"
          size="lg"
          @click="goLive(space.id)"
          ><Rocket :size="14" />Go live</Button
        >
      </div>
    </header>

    <Tabs v-model="tab" :options="tabs">
      <SpaceOverview v-if="tab === 'overview'" :space @tab="(t: Tab) => (tab = t)" />
      <SpaceCatalog v-else-if="tab === 'catalog'" :space-id="space.id" />
      <SpaceHomeBrand v-else-if="tab === 'home'" :space-id="space.id" />
      <div v-else-if="tab === 'members'" class="mt-8 flex flex-col gap-3.5">
        <MembersTable ref="members" :space-id="space.id" />
        <SpaceAccess :space-id="space.id" />
      </div>
      <SpaceUsage v-else-if="tab === 'usage'" :space-id="space.id" />
      <SpaceActivity v-else-if="tab === 'activity'" :space />
      <SpaceSettings v-else :space-id="space.id" />
    </Tabs>
  </div>
</template>
