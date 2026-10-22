<script setup lang="ts">
import { computed } from 'vue'
import { Database, Lock, MapPin, Server } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import Meter from '../../ui/Meter.vue'
import Select from '../../ui/Select.vue'
import Sparkline from '../../ui/Sparkline.vue'
import StatTile from '../../parts/env/StatTile.vue'
import { fmt } from '../../parts/env/env'
import type { Space, SpaceRequest } from '../../spaces'

/** How the space is doing, what they asked for, and the isolation
 *  guarantees of their space. */
const { space } = defineProps<{ space: Space }>()
const emit = defineEmits<{ tab: [tab: 'activity' | 'usage' | 'catalog'] }>()
const runs = computed(() => space.catalog.reduce((n, c) => n + c.runs, 0))
const active = computed(() => space.members.filter((m) => m.runs > 0).length)
const STATUS: { value: SpaceRequest['status']; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'building', label: 'Building' },
  { value: 'shipped', label: 'Shipped' }
]
const ISOLATION = computed(() => [
  { icon: Database, label: 'Storage', value: 'Own bucket, encrypted' },
  { icon: Server, label: 'Endpoints', value: `${space.catalog.length}, one per tool` },
  {
    icon: MapPin,
    label: 'Regions',
    value: [...new Set(space.catalog.map((c) => c.endpoint?.region.split(' · ')[0]))].join(', ')
  },
  { icon: Lock, label: 'Training', value: 'Never used to train models' }
])
</script>

<template>
  <Card class="mt-8 grid grid-cols-4 divide-x divide-border-default">
    <StatTile label="Runs · 30 days" :value="fmt(runs)"
      ><Sparkline :values="space.trend"
    /></StatTile>
    <StatTile
      label="Active people"
      :value="`${active} / ${space.members.length}`"
      hint="Ran a tool this month"
    />
    <StatTile
      label="Credits used"
      :value="fmt(space.used)"
      :hint="`of ${fmt(space.budget)} budget`"
    >
      <Meter :value="space.used" :max="space.budget" class="mb-2 w-20" />
    </StatTile>
    <StatTile
      label="Open requests"
      :value="String(space.requests.filter((r) => r.status !== 'shipped').length)"
      hint="From members"
    />
  </Card>

  <div class="mt-3.5 flex flex-col gap-3.5">
    <Card class="overflow-hidden">
      <div class="flex h-11 items-center border-b border-border-default px-5">
        <p class="text-ui font-medium">Requests</p>
      </div>
      <div
        v-for="r in space.requests"
        :key="r.id"
        class="flex items-center gap-4 border-b border-border-default px-5 py-3 last:border-b-0"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-ui font-medium">{{ r.title }}</p>
          <p class="text-ui text-subtle-foreground">{{ r.by }} · {{ r.when }}</p>
        </div>
        <Select v-model="r.status" variant="ghost" size="sm" class="w-32" :options="STATUS" />
      </div>
      <p v-if="!space.requests.length" class="px-5 py-6 text-ui text-subtle-foreground">
        No requests. Members ask for new tools from the space.
      </p>
    </Card>

    <div class="flex flex-col gap-3.5">
      <Card class="p-5">
        <div class="mb-3 flex items-center gap-2">
          <p class="flex-1 text-ui font-medium">Isolation</p>
          <Badge size="sm">Enforced</Badge>
        </div>
        <div class="grid grid-cols-4 gap-6">
          <div v-for="i in ISOLATION" :key="i.label" class="min-w-0 text-ui">
            <span class="flex items-center gap-2 text-muted-foreground"
              ><component :is="i.icon" :size="13" />{{ i.label }}</span
            >
            <span class="mt-1 block truncate">{{ i.value }}</span>
          </div>
        </div>
      </Card>
      <Card class="p-5">
        <div class="mb-2 flex items-center">
          <p class="flex-1 text-ui font-medium">Recent activity</p>
          <Button variant="link" size="sm" @click="emit('tab', 'activity')">All</Button>
        </div>
        <p v-for="(a, i) in space.activity.slice(0, 4)" :key="i" class="py-1.5 text-ui">
          <span class="font-medium">{{ a.who }}</span>
          <span class="ml-1 text-muted-foreground">{{ a.what }}</span>
          <span class="block text-ui text-subtle-foreground">{{ a.when }}</span>
        </p>
      </Card>
    </div>
  </div>
</template>
