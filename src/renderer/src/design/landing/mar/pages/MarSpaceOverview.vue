<script setup lang="ts">
import { computed } from 'vue'
import {
  Coins,
  Database,
  Lock,
  MapPin,
  MessageSquare,
  Play,
  Server,
  UserPlus,
  Users
} from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import Select from '../../ui/Select.vue'
import { fmt } from '../../parts/env/env'
import { FLAVOR_LABEL, type Space, type SpaceRequest } from '../../spaces'
import { thumb } from '../../mock'
import MarActivityTimeline from '../activity/MarActivityTimeline.vue'

/**
 * A space's overview (Mar's proposal): four numbers in the brand's colour,
 * each saying what it's waiting for when it's still zero; then what the
 * space holds (its tools, members' requests) next to what happened and how
 * it's kept apart. Only what the space already knows.
 */
const { space } = defineProps<{ space: Space }>()
const emit = defineEmits<{ tab: [tab: 'activity' | 'usage' | 'catalog']; invite: [] }>()

const runs = computed(() => space.catalog.reduce((n, c) => n + c.runs, 0))
const active = computed(() => space.members.filter((m) => m.runs > 0).length)
const open = computed(() => space.requests.filter((r) => r.status !== 'shipped').length)
const usedPct = computed(() => Math.round((space.used / Math.max(1, space.budget)) * 100))
const draft = computed(() => space.status === 'draft')

// The trend as a soft area under a line, in the brand's colour.
const W = 120
const H = 36
const trendPath = computed(() => {
  const v = space.trend
  const max = Math.max(1, ...v)
  const step = W / Math.max(1, v.length - 1)
  return v
    .map(
      (n, i) =>
        `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(H - 2 - (n / max) * (H - 6)).toFixed(1)}`
    )
    .join(' ')
})

// Most-run first: the tools members actually use lead.
const tools = computed(() => [...space.catalog].sort((a, b) => b.runs - a.runs).slice(0, 4))

const STATUS: { value: SpaceRequest['status']; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'building', label: 'Building' },
  { value: 'shipped', label: 'Shipped' }
]
const ISOLATION = computed(() => [
  { icon: Database, label: 'Storage', value: 'Own bucket, encrypted' },
  {
    icon: Server,
    label: 'Endpoints',
    value: space.catalog.length
      ? `${space.catalog.length}, one per tool`
      : 'One per tool, once published'
  },
  {
    icon: MapPin,
    label: 'Regions',
    value:
      [...new Set(space.catalog.map((c) => c.endpoint?.region.split(' · ')[0]))].join(', ') ||
      space.region.split(' · ')[0]
  },
  { icon: Lock, label: 'Training', value: 'Never used to train models' }
])
</script>

<template>
  <div class="mar-so" :style="{ '--space-accent': space.brand.color }">
    <!-- The brand's colour is for the cover and the chart only; every
         other icon and accent stays in the UI's own colours. -->
    <!-- The pulse: four tiles. A zero says what it's waiting for. -->
    <div class="mar-so-stats">
      <Card class="mar-so-stat">
        <span class="mar-so-label"><Play :size="13" />Runs · 30 days</span>
        <template v-if="runs">
          <span class="mar-so-value">{{ fmt(runs) }}</span>
          <svg
            class="mar-so-trend"
            :viewBox="`0 0 ${W} ${H}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path :d="`${trendPath} L${W} ${H} L0 ${H} Z`" class="mar-so-trend-fill" />
            <path :d="trendPath" class="mar-so-trend-line" />
          </svg>
        </template>
        <template v-else>
          <span class="mar-so-value is-empty">No runs yet</span>
          <span class="mar-so-hint">{{
            draft ? 'Starts when the space goes live' : 'Nobody ran a tool this month'
          }}</span>
        </template>
      </Card>

      <Card class="mar-so-stat">
        <span class="mar-so-label"><Users :size="13" />Active people</span>
        <template v-if="space.members.length">
          <span class="mar-so-value"
            >{{ active }}<span class="mar-so-of"> / {{ space.members.length }}</span></span
          >
          <span class="mar-so-hint">Ran a tool this month</span>
        </template>
        <template v-else>
          <span class="mar-so-value is-empty">No one yet</span>
          <button type="button" class="mar-so-act" @click="emit('invite')">
            <UserPlus :size="13" />Invite the client’s team
          </button>
        </template>
      </Card>

      <Card class="mar-so-stat">
        <span class="mar-so-label"><Coins :size="13" />Credits used</span>
        <template v-if="space.used">
          <span class="mar-so-value">{{ fmt(space.used) }}</span>
          <span class="mar-so-meter" :class="usedPct >= 80 && 'is-high'"
            ><i :style="{ width: `${Math.min(100, usedPct)}%` }"
          /></span>
          <span class="mar-so-hint">{{ usedPct }}% of {{ fmt(space.budget) }} this month</span>
        </template>
        <template v-else>
          <span class="mar-so-value is-empty">Nothing spent</span>
          <span class="mar-so-hint">{{ fmt(space.budget) }} budget a month</span>
        </template>
      </Card>

      <Card class="mar-so-stat">
        <span class="mar-so-label"><MessageSquare :size="13" />Open requests</span>
        <template v-if="open">
          <span class="mar-so-value">{{ open }}</span>
          <span class="mar-so-hint">From members</span>
        </template>
        <template v-else>
          <span class="mar-so-value is-empty">None open</span>
          <span class="mar-so-hint">Members ask for new tools here</span>
        </template>
      </Card>
    </div>

    <!-- What the space holds: its tools, most used first. -->
    <Card class="overflow-hidden">
      <div class="mar-so-head">
        <p class="mar-so-title flex-1">
          Tools<span v-if="space.catalog.length" class="mar-so-count">{{
            space.catalog.length
          }}</span
          ><span v-else class="mar-so-count"
            >None yet. Publish an app or a workflow and members can run it here.</span
          >
        </p>
        <Button v-if="space.catalog.length" variant="link" size="sm" @click="emit('tab', 'catalog')"
          >All</Button
        >
      </div>
      <div v-for="t in tools" :key="t.id" class="mar-so-tool">
        <img :src="thumb(t.thumbId)" alt="" class="mar-so-thumb" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-ui font-medium">{{ t.name }}</p>
          <p class="truncate text-ui text-subtle-foreground">
            {{ FLAVOR_LABEL[t.flavor] }} · {{ t.cost }} credits a run
          </p>
        </div>
        <span class="mar-so-runs">{{ t.runs ? `${fmt(t.runs)} runs` : 'Not run yet' }}</span>
      </div>
    </Card>

    <Card class="overflow-hidden">
      <div class="mar-so-head">
        <p class="mar-so-title flex-1">
          Requests<span v-if="open" class="mar-so-count">{{ open }} open</span
          ><span v-else-if="!space.requests.length" class="mar-so-count"
            >None yet. Members ask for new tools from the space.</span
          >
        </p>
      </div>
      <div v-for="r in space.requests" :key="r.id" class="mar-so-row">
        <div class="min-w-0 flex-1">
          <p class="truncate text-ui font-medium">{{ r.title }}</p>
          <p class="text-ui text-subtle-foreground">{{ r.by }} · {{ r.when }}</p>
        </div>
        <Select v-model="r.status" variant="ghost" size="sm" class="w-32" :options="STATUS" />
      </div>
    </Card>
    <!-- Two columns that size to what they hold; they stack when narrow. -->
    <div class="mar-so-pair">
      <Card class="p-5">
        <div class="mb-2 flex items-center">
          <p class="mar-so-title flex-1">Recent activity</p>
          <Button variant="link" size="sm" @click="emit('tab', 'activity')">All</Button>
        </div>
        <MarActivityTimeline :items="space.activity.slice(0, 5)" />
      </Card>

      <Card class="p-5">
        <div class="mb-3 flex items-center">
          <p class="mar-so-title flex-1">Isolation</p>
          <Badge size="sm">Enforced</Badge>
        </div>
        <dl class="mar-so-facts">
          <div v-for="i in ISOLATION" :key="i.label" class="mar-so-fact">
            <dt><component :is="i.icon" :size="13" />{{ i.label }}</dt>
            <dd>{{ i.value }}</dd>
          </div>
        </dl>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.mar-so {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.mar-so-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.mar-so-stat {
  position: relative;
  display: flex;
  min-height: 118px;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  overflow: hidden;
  padding: 16px 18px;
}
.mar-so-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--color-muted-foreground);
  font-size: 13px;
}
.mar-so-label > svg {
  color: var(--color-subtle-foreground);
}
.mar-so-value {
  margin-top: 12px;
  color: var(--color-base-foreground);
  font-size: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
/* A zero is a sentence, not a big "0". */
.mar-so-value.is-empty {
  color: var(--color-muted-foreground);
  font-size: 17px;
  font-weight: 500;
  letter-spacing: -0.01em;
  line-height: 1.3;
}
.mar-so-of {
  margin-left: 2px;
  color: var(--color-subtle-foreground);
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0;
}
.mar-so-hint {
  margin-top: auto;
  padding-top: 8px;
  overflow: hidden;
  max-width: 100%;
  color: var(--color-subtle-foreground);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .mar-so-act {
  display: inline-flex;
  height: 26px;
  align-items: center;
  gap: 6px;
  margin: auto 0 -4px -8px;
  padding: 0 8px;
  border-radius: var(--radius-control);
  color: var(--color-base-foreground);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui .mar-so-act:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
/* The runs trend: bottom-right of its tile, in the brand's colour. */
.mar-so-trend {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 58%;
  height: 52px;
}
.mar-so-trend-fill {
  fill: color-mix(in oklch, var(--space-accent) 16%, transparent);
}
.mar-so-trend-line {
  fill: none;
  stroke: var(--space-accent);
  stroke-width: 1.5;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.mar-so-meter {
  display: block;
  width: 100%;
  height: 4px;
  margin-top: 12px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
}
.mar-so-meter > i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: color-mix(in oklch, var(--color-base-foreground) 70%, transparent);
}
.mar-so-meter.is-high > i {
  background: var(--color-status-warning, var(--color-base-foreground));
}
.mar-so-meter + .mar-so-hint {
  margin-top: 0;
}

.mar-so {
  container-type: inline-size;
}
/* Activity and Isolation: side by side, each as tall as its content. */
.mar-so-pair {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
@container (max-width: 760px) {
  .mar-so-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .mar-so-pair {
    grid-template-columns: minmax(0, 1fr);
  }
}
.mar-so-head {
  display: flex;
  height: 48px;
  align-items: center;
  padding: 0 12px 0 20px;
}
.mar-so-title {
  color: var(--color-base-foreground);
  font-size: 14px;
  font-weight: 500;
}
.mar-so-count {
  margin-left: 8px;
  color: var(--color-subtle-foreground);
  font-size: 13px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.mar-so-tool,
.mar-so-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 20px;
  border-top: 1px solid var(--color-border-default);
}
.mar-so-thumb {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 10px;
  object-fit: cover;
}
.mar-so-runs {
  flex-shrink: 0;
  color: var(--color-muted-foreground);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
/* Isolation: each value under its label, wrapping, two to a row. */
.mar-so-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
  margin: 0;
}
.mar-so-fact {
  min-width: 0;
  font-size: 13px;
}
.mar-so-fact dt {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--color-muted-foreground);
}
.mar-so-fact dd {
  margin: 4px 0 0;
  color: var(--color-base-foreground);
  overflow-wrap: anywhere;
}
</style>
