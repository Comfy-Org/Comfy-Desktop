<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search } from 'lucide-vue-next'
import Checkbox from '../../ui/Checkbox.vue'
import Input from '../../ui/Input.vue'
import { DETECTED, NODE_PACKS, flow, packFits, type NodePack } from './setupFlow'

/**
 * Custom nodes with the install (DESK-243): the recommended packs come
 * ticked, the rest of the registry is a search away, and none is needed.
 * A pack not tested on this computer shows, but can't be picked. Shared by
 * a new build's step and the Home card's Edit packs.
 */
const query = ref('')
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const all = q
    ? NODE_PACKS.filter((p) => `${p.name} ${p.author} ${p.adds}`.toLowerCase().includes(q))
    : NODE_PACKS
  return {
    recommended: all.filter((p) => p.recommended),
    more: all.filter((p) => !p.recommended)
  }
})
const on = (p: NodePack): boolean => flow.packs.includes(p.id)
function toggle(p: NodePack, v: boolean): void {
  flow.packs = v ? [...flow.packs, p.id] : flow.packs.filter((id) => id !== p.id)
}
</script>

<template>
  <div class="mss-nodes">
    <Input v-model="query" placeholder="Search node packs" aria-label="Search node packs">
      <template #leading><Search :size="14" class="text-subtle-foreground" /></template>
    </Input>
    <div class="mss-nodes-list">
      <template v-for="group in ['recommended', 'more'] as const" :key="group">
        <p v-if="shown[group].length" class="mss-nodes-head">
          {{ group === 'recommended' ? 'Recommended' : 'More from the registry' }}
        </p>
        <label
          v-for="p in shown[group]"
          :key="p.id"
          class="mss-nodes-row"
          :class="!packFits(p) && 'is-off'"
        >
          <Checkbox
            :model-value="on(p)"
            :disabled="!packFits(p)"
            :aria-label="p.name"
            @update:model-value="(v) => toggle(p, v)"
          />
          <span class="grid min-w-0">
            <span class="mss-nodes-name"
              >{{ p.name }}<span class="mss-nodes-by">{{ p.author }}</span></span
            >
            <span class="mss-nodes-adds">{{
              packFits(p) ? p.adds : `Not tested on ${DETECTED.noun} yet`
            }}</span>
          </span>
          <span class="mss-nodes-mb tabular-nums">{{ p.mb }} MB</span>
        </label>
      </template>
      <p v-if="!shown.recommended.length && !shown.more.length" class="mss-nodes-empty">
        No node packs match "{{ query }}".
      </p>
    </div>
  </div>
</template>

<style>
.mss-nodes {
  display: grid;
  gap: 12px;
  margin-top: 4px;
}
.mss-nodes-list {
  display: grid;
  max-height: 300px;
  overflow-y: auto;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
  padding: 4px;
}
.mss-nodes-head {
  padding: 10px 12px 4px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .mss-nodes-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
}
:root .proto-ui.proto-ui.proto-ui .mss-nodes-row:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mss-nodes-row.is-off {
  cursor: default;
  opacity: 0.55;
}
:root .proto-ui.proto-ui.proto-ui .mss-nodes-row.is-off:hover {
  background: none;
}
.mss-nodes-name {
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mss-nodes-by {
  margin-left: 6px;
  color: var(--color-subtle-foreground);
  font-weight: 400;
}
.mss-nodes-adds {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mss-nodes-mb {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.mss-nodes-empty {
  padding: 16px 12px;
  color: var(--color-subtle-foreground);
  font-size: 13px;
}
</style>
