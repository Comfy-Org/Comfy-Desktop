<script setup lang="ts">
import { computed } from 'vue'
import { Check, Home, Settings2 } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import LocationIcon from '../../ui/LocationIcon.vue'
import { instanceById, instances, proto } from '../../useProto'
import { openFromMenu, switcherMenu } from '../../titleBar'
import { can } from '../../milestones'

/**
 * The browser preview's build switcher (the stand-in title bar's chevron):
 * Home, the open builds, then the others to open. In the app the real
 * title bar shows it as a popup with each build's state (TitleBarApp).
 * `top` is where the bar ends.
 */
const { top } = defineProps<{ top: number }>()

const isOpen = (id: string): boolean => proto.tabs.some((t) => t.instanceId === id)
const front = computed(() => proto.tabs.find((t) => t.id === proto.activeTab)?.instanceId)
const openBuilds = computed(() =>
  proto.tabs.map((t) => instanceById(t.instanceId)).filter((i) => !!i)
)
const closedBuilds = computed(() => instances.value.filter((i) => !isOpen(i.id)))
</script>

<template>
  <DropdownMenuRoot v-model:open="switcherMenu.open" :modal="false">
    <DropdownMenuTrigger as-child>
      <span
        aria-hidden="true"
        class="pointer-events-none fixed h-0"
        :style="{
          top: `${top}px`,
          left: `${switcherMenu.left}px`,
          width: `${switcherMenu.width}px`
        }"
      />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" :side-offset="2" class="w-64">
      <DropdownMenuItem @select="openFromMenu('home')">
        <Home :size="16" /><span class="flex-1">{{ can.home ? 'Home' : 'All builds' }}</span>
        <Check v-if="proto.activeTab === 'home'" :size="14" />
      </DropdownMenuItem>
      <template v-if="openBuilds.length">
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Open</DropdownMenuLabel>
        <DropdownMenuItem v-for="e in openBuilds" :key="e.id" @select="openFromMenu(e.id)">
          <LocationIcon :kind="e.kind === 'cloud' ? 'cloud' : 'local'" :size="16" />
          <span class="flex-1 truncate">{{ e.name }}</span>
          <Check v-if="e.id === front" :size="14" />
        </DropdownMenuItem>
      </template>
      <template v-if="closedBuilds.length">
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Recently used</DropdownMenuLabel>
        <DropdownMenuItem v-for="e in closedBuilds" :key="e.id" @select="openFromMenu(e.id)">
          <LocationIcon :kind="e.kind === 'cloud' ? 'cloud' : 'local'" :size="16" />
          <span class="flex-1 truncate">{{ e.name }}</span>
        </DropdownMenuItem>
      </template>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="openFromMenu('manage')">
        <Settings2 :size="16" />Manage builds
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>
