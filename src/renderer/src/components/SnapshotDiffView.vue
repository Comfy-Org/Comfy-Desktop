<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown } from 'lucide-vue-next'
import type { SnapshotDiffResult } from '../types/ipc'
import { formatNodeVersion } from '../lib/snapshots'

const props = defineProps<{
  diff: SnapshotDiffResult
  /** Collapse the Custom Nodes + Pip Packages sections to count headers, for
   *  tight surfaces where a large diff would overflow. */
  collapsible?: boolean
}>()

const { t } = useI18n()

const nodesOpen = ref(false)
const pipsOpen = ref(false)

const nodeChangeCount = computed(
  () =>
    props.diff.nodesAdded.length + props.diff.nodesRemoved.length + props.diff.nodesChanged.length
)
const pipChangeCount = computed(
  () => props.diff.pipsAdded.length + props.diff.pipsRemoved.length + props.diff.pipsChanged.length
)

function formatVersion(v: { formattedVersion: string }): string {
  return v.formattedVersion
}
</script>

<template>
  <div v-if="diff.comfyuiChanged && diff.comfyui" class="diff-section mb-2 last:mb-0">
    <div
      class="diff-section-title mb-1 text-[11px] font-medium text-text-muted uppercase tracking-[0.04em]"
    >
      {{ t('snapshots.comfyuiVersion') }}
    </div>
    <div
      class="diff-line overflow-hidden text-ellipsis whitespace-nowrap py-px text-[12px] [font-family:var(--font-mono,ui-monospace,monospace)] select-text diff-changed text-text-muted"
    >
      {{ formatVersion(diff.comfyui.from) }} → {{ formatVersion(diff.comfyui.to) }}
    </div>
  </div>

  <div v-if="diff.updateChannelChanged && diff.updateChannel" class="diff-section mb-2 last:mb-0">
    <div
      class="diff-section-title mb-1 text-[11px] font-medium text-text-muted uppercase tracking-[0.04em]"
    >
      {{ t('snapshots.updateChannel') }}
    </div>
    <div
      class="diff-line overflow-hidden text-ellipsis whitespace-nowrap py-px text-[12px] [font-family:var(--font-mono,ui-monospace,monospace)] select-text diff-changed text-text-muted"
    >
      {{ diff.updateChannel.from }} → {{ diff.updateChannel.to }}
    </div>
  </div>

  <div v-if="nodeChangeCount > 0" class="diff-section mb-2 last:mb-0">
    <div
      class="diff-section-title text-[11px] font-medium text-text-muted uppercase tracking-[0.04em]"
      :class="
        collapsible
          ? 'is-toggle mb-0 flex cursor-pointer select-none items-center gap-1 py-[3px] hover:text-text'
          : 'mb-1'
      "
      @click="collapsible ? (nodesOpen = !nodesOpen) : null"
    >
      <ChevronDown
        v-if="collapsible"
        :size="12"
        class="diff-section-chevron shrink-0 transition-transform duration-[160ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
        :class="{ '[transform:rotate(180deg)]': nodesOpen }"
      />
      <span>{{ t('snapshots.customNodes') }} ({{ nodeChangeCount }})</span>
    </div>
    <div
      v-show="!collapsible || nodesOpen"
      class="diff-section-lines"
      :class="{ 'mt-0.5 pl-4': collapsible }"
    >
      <div
        v-for="n in diff.nodesAdded"
        :key="'add-' + n.id"
        class="diff-line overflow-hidden text-ellipsis whitespace-nowrap py-px text-[12px] [font-family:var(--font-mono,ui-monospace,monospace)] select-text diff-added text-[color-mix(in_oklab,var(--success)_60%,var(--text))]"
      >
        + {{ n.id }} {{ formatNodeVersion(n) }}
      </div>
      <div
        v-for="n in diff.nodesRemoved"
        :key="'rem-' + n.id"
        class="diff-line overflow-hidden text-ellipsis whitespace-nowrap py-px text-[12px] [font-family:var(--font-mono,ui-monospace,monospace)] select-text diff-removed text-[color-mix(in_oklab,var(--danger)_60%,var(--text))]"
      >
        − {{ n.id }} {{ formatNodeVersion(n) }}
      </div>
      <div
        v-for="n in diff.nodesChanged"
        :key="'chg-' + n.id"
        class="diff-line overflow-hidden text-ellipsis whitespace-nowrap py-px text-[12px] [font-family:var(--font-mono,ui-monospace,monospace)] select-text diff-changed text-text-muted"
      >
        ~ {{ n.id }}: {{ n.from.version || (n.from.commit ? n.from.commit.slice(0, 7) : '?') }} →
        {{ n.to.version || (n.to.commit ? n.to.commit.slice(0, 7) : '?') }}
        <template v-if="n.from.enabled !== n.to.enabled"
          >, {{ n.from.enabled ? 'enabled' : 'disabled' }} →
          {{ n.to.enabled ? 'enabled' : 'disabled' }}</template
        >
      </div>
    </div>
  </div>

  <div v-if="pipChangeCount > 0" class="diff-section mb-2 last:mb-0">
    <div
      class="diff-section-title text-[11px] font-medium text-text-muted uppercase tracking-[0.04em]"
      :class="
        collapsible
          ? 'is-toggle mb-0 flex cursor-pointer select-none items-center gap-1 py-[3px] hover:text-text'
          : 'mb-1'
      "
      @click="collapsible ? (pipsOpen = !pipsOpen) : null"
    >
      <ChevronDown
        v-if="collapsible"
        :size="12"
        class="diff-section-chevron shrink-0 transition-transform duration-[160ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
        :class="{ '[transform:rotate(180deg)]': pipsOpen }"
      />
      <span>{{ t('snapshots.pipPackages') }} ({{ pipChangeCount }})</span>
    </div>
    <div
      v-show="!collapsible || pipsOpen"
      class="diff-section-lines"
      :class="{ 'mt-0.5 pl-4': collapsible }"
    >
      <div
        v-for="p in diff.pipsAdded"
        :key="'padd-' + p.name"
        class="diff-line overflow-hidden text-ellipsis whitespace-nowrap py-px text-[12px] [font-family:var(--font-mono,ui-monospace,monospace)] select-text diff-added text-[color-mix(in_oklab,var(--success)_60%,var(--text))]"
      >
        + {{ p.name }} {{ p.version }}
      </div>
      <div
        v-for="p in diff.pipsRemoved"
        :key="'prem-' + p.name"
        class="diff-line overflow-hidden text-ellipsis whitespace-nowrap py-px text-[12px] [font-family:var(--font-mono,ui-monospace,monospace)] select-text diff-removed text-[color-mix(in_oklab,var(--danger)_60%,var(--text))]"
      >
        − {{ p.name }} {{ p.version }}
      </div>
      <div
        v-for="p in diff.pipsChanged"
        :key="'pchg-' + p.name"
        class="diff-line overflow-hidden text-ellipsis whitespace-nowrap py-px text-[12px] [font-family:var(--font-mono,ui-monospace,monospace)] select-text diff-changed text-text-muted"
      >
        ~ {{ p.name }}: {{ p.from }} → {{ p.to }}
      </div>
    </div>
  </div>
</template>
