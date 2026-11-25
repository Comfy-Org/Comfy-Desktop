<script setup lang="ts">
import { computed } from 'vue'
import { Cloud, Laptop } from 'lucide-vue-next'
import SectionHeader from '../../ui/SectionHeader.vue'
import { go, hostActions, instances, proto, toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { envKind } from '../../parts/env/env'

/**
 * 18 · Build health: your three most recent builds under the prompt, each
 * with how hard it's working (GPU and VRAM meters), what's waiting and one
 * action: Open, or Update when one is out. The first live build gets the
 * white button. GPU, VRAM and queue are mock readings.
 */
const builds = computed(() =>
  [...instances.value].sort((a, b) => a.lastUsedRank - b.lastUsedRank).slice(0, 3)
)

const READINGS: Record<string, { gpu: number; vram: number; queue: number }> = {
  'local-1': { gpu: 18, vram: 6.2, queue: 0 },
  'local-video': { gpu: 72, vram: 24.8, queue: 2 },
  cloud: { gpu: 35, vram: 28, queue: 1 },
  'dep-product': { gpu: 54, vram: 41, queue: 3 }
}

type Health = {
  live: boolean
  chip: string
  sub: string
  gpu: number
  vram: number
  total: number
  footer: string
  action: 'open' | 'update' | 'login'
}

function health(i: ProtoInstance): Health {
  const managed = envKind(i) === 'managed'
  const live = i.state === 'running' || (managed && proto.signedIn)
  const r = live || i.state === 'update' ? (READINGS[i.id] ?? { gpu: 12, vram: 4, queue: 0 }) : null
  const total = Number(/(\d+)\s*GB/.exec(i.gpu ?? '')?.[1] ?? 36)
  const chip = live
    ? 'Running'
    : i.state === 'update'
      ? 'Update'
      : managed
        ? 'Log in to use'
        : 'Stopped'
  const gpuName = (i.gpu ?? '').split('·')[0]!.trim()
  return {
    live,
    chip,
    sub: [i.version ? `ComfyUI ${i.version}` : 'Latest', gpuName].filter(Boolean).join(' · '),
    gpu: r?.gpu ?? 0,
    vram: r?.vram ?? 0,
    total,
    footer: !r ? 'Stopped' : r.queue ? `${r.queue} in queue` : 'Idle',
    action: i.state === 'update' ? 'update' : managed && !proto.signedIn ? 'login' : 'open'
  }
}
const cards = computed(() => builds.value.map((i) => ({ i, h: health(i) })))
const lead = computed(() => cards.value.find((c) => c.h.live)?.i.id)

function act(i: ProtoInstance, h: Health): void {
  if (h.action === 'update') toast(`Updating ${i.name}`)
  else hostActions.launch(i)
}
const vram = (n: number): string => (Number.isInteger(n) ? `${n}` : n.toFixed(1))
</script>

<template>
  <section class="mx-auto mt-8 w-full">
    <SectionHeader class="mar-sec" title="Your builds" link="All builds" @link="go('environments')">
      <template #controls>
        <span class="text-ui text-subtle-foreground">{{ instances.length }}</span>
      </template>
    </SectionHeader>
    <!-- One, two or three builds always fill the row. -->
    <div
      class="grid gap-3.5"
      :style="{ gridTemplateColumns: `repeat(${Math.min(cards.length, 3)}, minmax(0, 1fr))` }"
    >
      <div
        v-for="{ i, h } in cards"
        :key="i.id"
        class="p18-card flex min-w-0 flex-col gap-3.5 rounded-[18px] p-4"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="p18-well flex size-8 shrink-0 items-center justify-center rounded-[10px]">
            <component :is="i.kind === 'cloud' ? Cloud : Laptop" :size="16" />
          </span>
          <span class="min-w-0 flex-1 leading-[1.4]">
            <span class="block truncate text-[14px] font-semibold text-base-foreground">{{
              i.name
            }}</span>
            <span class="block truncate text-[11px] text-subtle-foreground">{{ h.sub }}</span>
          </span>
          <span
            :class="[
              'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-[7px] px-[7px] text-[11px] font-medium',
              h.live ? 'p18-running' : 'p18-quiet'
            ]"
          >
            <span v-if="h.live" class="size-1.5 rounded-full bg-current" />{{ h.chip }}
          </span>
        </div>

        <div
          v-for="m in [
            { label: 'GPU', value: `${h.gpu}%`, at: h.gpu / 100 },
            { label: 'VRAM', value: `${vram(h.vram)} / ${h.total} GB`, at: h.vram / h.total }
          ]"
          :key="m.label"
          class="flex flex-col gap-1.5"
        >
          <span class="flex items-center justify-between text-[12px] leading-[1.4]">
            <span class="text-muted-foreground">{{ m.label }}</span>
            <span class="font-medium text-base-foreground tabular-nums">{{ m.value }}</span>
          </span>
          <span
            class="p18-track relative block h-[5px] overflow-hidden rounded-[2.5px]"
            role="meter"
            :aria-label="m.label"
            :aria-valuenow="Math.round(m.at * 100)"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span
              class="p18-fill absolute inset-y-0 left-0 rounded-[2.5px] bg-base-foreground"
              :style="{ width: `${Math.min(1, m.at) * 100}%` }"
            />
          </span>
        </div>

        <div class="flex items-center gap-2">
          <span class="flex-1 truncate text-[12px] leading-[1.4] text-subtle-foreground">{{
            h.footer
          }}</span>
          <button
            type="button"
            :class="['p18-btn', i.id === lead ? 'is-primary' : '']"
            @click="act(i, h)"
          >
            {{ h.action === 'update' ? 'Update' : h.action === 'login' ? 'Log in' : 'Open' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.p18-card {
  background-color: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  backdrop-filter: blur(24px);
}
.p18-well {
  color: var(--color-muted-foreground);
  background-color: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
}
.p18-running {
  color: var(--color-status-running);
  background-color: color-mix(in oklch, var(--color-status-running) 14%, transparent);
}
.p18-quiet {
  color: var(--color-muted-foreground);
  background-color: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
}
.p18-track {
  background-color: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.p18-fill {
  transition: width 500ms cubic-bezier(0.22, 1, 0.36, 1);
}
@media (prefers-reduced-motion: reduce) {
  .p18-fill {
    transition: none;
  }
}
</style>

<style>
/* Buttons are styled here: the prototype's reset wipes their padding. */
:root .proto-ui.proto-ui.proto-ui .p18-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-base-foreground);
  background-color: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  transition: background-color 120ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p18-btn:hover {
  background-color: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .p18-btn.is-primary {
  color: var(--color-inverted-foreground);
  background-color: var(--color-inverted-background);
}
:root .proto-ui.proto-ui.proto-ui .p18-btn.is-primary:hover {
  background-color: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .p18-btn:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
</style>
