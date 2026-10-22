<script setup lang="ts">
import { computed, ref } from 'vue'
import { Download, Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import Meter from '../../ui/Meter.vue'
import PageHeader from '../../ui/PageHeader.vue'
import Tabs from '../../ui/Tabs.vue'
import StatTile from '../../parts/env/StatTile.vue'
import SpaceCard from '../../parts/space/SpaceCard.vue'
import SpaceMark from '../../parts/space/SpaceMark.vue'
import { fmt } from '../../parts/env/env'
import { SPACES, type Space } from '../../spaces'
import { go, proto, toast } from '../../useProto'

/** Every space, with billing across all of them on top. */
const billed = (s: Space): number => Math.round(s.used * (1 + s.billing.markup / 100))
const seats = (s: Space): number => s.members.filter((m) => m.role !== 'viewer').length
const usd = (credits: number): string => `$${fmt(Math.round(credits / 100))}`
const total = computed(() => SPACES.reduce((n, s) => n + s.used, 0))
const totalBilled = computed(() => SPACES.reduce((n, s) => n + billed(s), 0))
const totalSeats = computed(() => SPACES.reduce((n, s) => n + seats(s), 0))
const atRisk = computed(() => SPACES.filter((s) => s.used / s.budget >= 0.8))
const tab = ref<'spaces' | 'billing'>('spaces')
const rows = computed(() => [...SPACES].sort((a, b) => b.used - a.used))
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader
      title="Spaces"
      description="Branded, isolated places for a team, customer or brand. Each has its own people, tools, data and budget - and can't see the others."
    >
      <template #actions
        ><Button variant="primary" size="lg" @click="proto.creatingSpace = true"
          ><Plus :size="15" />New space</Button
        ></template
      >
    </PageHeader>

    <Tabs
      v-model="tab"
      :options="[
        { value: 'spaces', label: 'Spaces', count: SPACES.length },
        { value: 'billing', label: 'Billing' }
      ]"
    >
      <template v-if="tab === 'billing'">
        <!-- Billing across spaces -->
        <Card class="mt-8 grid grid-cols-4 divide-x divide-border-default">
          <StatTile
            label="Spend · this month"
            :value="usd(total)"
            :hint="`${fmt(total)} credits`"
          />
          <StatTile
            label="Billed to spaces"
            :value="usd(totalBilled)"
            :hint="`${usd(totalBilled - total)} margin from markups`"
          />
          <StatTile label="Paid seats" :value="String(totalSeats)" hint="Viewers are free" />
          <StatTile
            label="Near budget"
            :value="String(atRisk.length)"
            :hint="atRisk.map((s) => s.name).join(', ') || 'All within budget'"
          />
        </Card>

        <Card class="mt-3.5 overflow-hidden">
          <div
            class="grid h-10 grid-cols-[minmax(0,1fr)_200px_110px_80px_110px_70px] items-center gap-4 border-b border-border-default px-5 text-ui text-subtle-foreground"
          >
            <span>Space</span><span>Budget</span><span class="text-right">Spend</span
            ><span class="text-right">Markup</span><span class="text-right">Billed</span
            ><span class="text-right">Seats</span>
          </div>
          <button
            v-for="s in rows"
            :key="s.id"
            type="button"
            class="grid min-h-13 w-full grid-cols-[minmax(0,1fr)_200px_110px_80px_110px_70px] items-center gap-4 border-b border-border-default px-5 text-left outline-none last:border-b-0 hover:bg-secondary-background/50 focus-visible:bg-secondary-background"
            @click="go(`space:${s.id}`)"
          >
            <span class="flex min-w-0 items-center gap-2.5"
              ><SpaceMark :brand="s.brand" size="sm" /><span class="truncate text-ui font-medium">{{
                s.name
              }}</span></span
            >
            <span class="flex items-center gap-2.5">
              <Meter :value="s.used" :max="s.budget" class="flex-1" />
              <span class="w-9 text-right text-ui text-subtle-foreground tabular-nums"
                >{{ Math.round((s.used / s.budget) * 100) }}%</span
              >
            </span>
            <span class="text-right text-ui tabular-nums">{{ usd(s.used) }}</span>
            <span class="text-right text-ui text-muted-foreground tabular-nums"
              >{{ s.billing.markup }}%</span
            >
            <span class="text-right text-ui tabular-nums">{{ usd(billed(s)) }}</span>
            <span class="text-right text-ui text-muted-foreground tabular-nums">{{
              seats(s)
            }}</span>
          </button>
          <div class="flex items-center justify-end border-t border-border-default px-5 py-2.5">
            <Button size="sm" variant="ghost" @click="toast('Exported billing.csv')"
              ><Download :size="13" />Export all</Button
            >
          </div>
        </Card>
      </template>
      <div v-else class="mt-8 grid grid-cols-3 gap-3.5">
        <SpaceCard v-for="s in SPACES" :key="s.id" :space="s" />
      </div>
    </Tabs>
  </div>
</template>
