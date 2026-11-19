<script setup lang="ts">
import { computed } from 'vue'
import Badge from '../../ui/Badge.vue'
import Card from '../../ui/Card.vue'
import Meter from '../../ui/Meter.vue'
import Sparkline from '../../ui/Sparkline.vue'
import SpaceMark from './SpaceMark.vue'
import MemberAvatar from '../MemberAvatar.vue'
import { isOnline, type Space } from '../../spaces'
import { go } from '../../useProto'

/** A client space at a glance: who, how busy, budget, open requests. */
const { space } = defineProps<{ space: Space }>()
const online = computed(() => space.members.filter(isOnline).length)
const sorted = computed(() =>
  [...space.members].sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)))
)
const open = computed(() => space.requests.filter((r) => r.status === 'new').length)
</script>

<template>
  <Card
    as="button"
    interactive
    class="flex min-w-0 flex-col gap-4 p-4 text-left"
    @click="go(`space:${space.id}`)"
  >
    <div class="flex items-center gap-2.5">
      <SpaceMark :brand="space.brand" size="md" />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-ui font-semibold">{{ space.name }}</span>
        <span class="block truncate text-ui text-subtle-foreground">{{ space.domain }}</span>
      </span>
      <Badge v-if="space.status !== 'live'" variant="outline" size="sm" class="capitalize">{{
        space.status
      }}</Badge>
    </div>
    <div class="flex items-end justify-between gap-3">
      <span class="flex min-w-0 flex-col gap-2">
        <!-- Who's in the space: online people bright, the rest dimmed. -->
        <span v-if="space.members.length" class="flex items-center -space-x-1">
          <span
            v-for="m in sorted.slice(0, 6)"
            :key="m.email"
            :title="`${m.name} · ${isOnline(m) ? 'Online' : m.lastActive}`"
            :class="[
              'relative rounded-full ring-2 ring-card-background',
              !isOnline(m) && 'opacity-35'
            ]"
          >
            <MemberAvatar :name="m.name" size="md" />
            <span
              v-if="isOnline(m)"
              class="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-status-running ring-2 ring-card-background"
            />
          </span>
          <span
            v-if="space.members.length > 6"
            class="relative inline-flex size-7 items-center justify-center rounded-full bg-secondary-background text-ui ring-2 ring-card-background"
            >+{{ space.members.length - 6 }}</span
          >
        </span>
        <span class="mar-space-meta text-ui text-subtle-foreground"
          >{{ online }} online · {{ space.members.length }} people ·
          {{ space.catalog.filter((c) => c.visible).length }} tools</span
        >
      </span>
      <Sparkline :values="space.trend" :width="64" :height="20" />
    </div>
    <div>
      <Meter :value="space.used" :max="space.budget" />
      <p class="mt-1.5 flex justify-between text-ui text-subtle-foreground">
        <span>{{ Math.round((space.used / space.budget) * 100) }}% of budget</span>
        <span v-if="open">{{ open }} new {{ open === 1 ? 'request' : 'requests' }}</span>
      </p>
    </div>
  </Card>
</template>
