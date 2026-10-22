<script setup lang="ts">
import { computed } from 'vue'
import Tooltip from '../../ui/Tooltip.vue'
import SpaceMark from './SpaceMark.vue'
import { placementsOf, type Flavor } from '../../spaces'

/** Which spaces an app or workflow is deployed to. */
const { kind, name } = defineProps<{ kind: Flavor; name: string }>()
const spaces = computed(() => placementsOf({ kind, name }).spaces)
</script>

<template>
  <span v-if="spaces.length" class="flex min-w-0 items-center gap-2 text-ui text-muted-foreground">
    <Tooltip :content="spaces.map((s) => s.name).join(', ')">
      <span class="flex items-center -space-x-1">
        <SpaceMark
          v-for="s in spaces"
          :key="s.id"
          :brand="s.brand"
          size="xs"
          class="rounded-min ring-2 ring-card-background"
        />
      </span>
    </Tooltip>
    <span class="truncate">{{ spaces.length }} {{ spaces.length === 1 ? 'space' : 'spaces' }}</span>
  </span>
  <span v-else class="text-ui text-subtle-foreground">Not in a space</span>
</template>
