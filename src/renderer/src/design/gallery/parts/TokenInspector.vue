<script setup lang="ts">
import { computed, onBeforeUnmount, watchEffect } from 'vue'
import { Combine } from 'lucide-vue-next'
import Button from '../../landing/ui/Button.vue'
import SegmentedControl from '../../landing/ui/SegmentedControl.vue'
import Select from '../../landing/ui/Select.vue'
import { scopedActions, tokenTab } from '../inspect/actions'
import { declarationOf, tokenReference, utilitiesOf } from '../reference'
import type { ConsolidateGroup } from '../consolidate/rules'
import { startConsolidate } from '../consolidate/session'
import { namespaceOf } from '../theme'
import CopyRef from './CopyRef.vue'
import TokenControl from './TokenControl.vue'
import UsageList from './UsageList.vue'
import { tokenByName } from '../inspect/selection'
import { usageOf } from '../inspect/usage'
import { tokenOptions } from '../tokenOptions'
import { groupLabel, shortName, type Token } from '../tokens'
import { draft, isChanged, mergedInto, mergeToken, revertToken } from '../tweaks'

/** A selected token, in tabs like a component's: Edit token (its value,
 *  everywhere), Merge (move its uses onto another token) and Info (where
 *  it's declared and used). Sub-properties travel with their parent, so
 *  they can't merge on their own. */
const { token } = defineProps<{ token: Token }>()
const usage = computed(() => usageOf(token))
const merge = computed(() => mergedInto(token))
const changed = computed(() => isChanged(token) || !!merge.value)
const mergeOptions = computed(() =>
  tokenOptions(token.group).filter((o) => o.value !== token.name && !draft.merges[o.value])
)
const scope = computed(() => ({
  tokens: isChanged(token) ? [token] : [],
  swaps: [],
  merges: merge.value ? ([[token.name, merge.value]] as [string, string][]) : []
}))
// Footer actions: copy / revert this token's changes.
watchEffect(() => {
  scopedActions.value = {
    label: shortName(token),
    changes: changed.value ? 1 : 0,
    scope: scope.value,
    revert: changed.value ? () => revertToken(token) : undefined
  }
})
onBeforeUnmount(() => (scopedActions.value = null))

type Tab = 'edit' | 'merge' | 'info'
// Sticks while moving between tokens.
const mode = tokenTab
const canMerge = computed(() => !token.parent)
const tab = computed<Tab>({
  get: () => (mode.value === 'merge' && !canMerge.value ? 'edit' : mode.value),
  set: (v) => (mode.value = v)
})
const tabs = computed(() => [
  { value: 'edit' as Tab, label: 'Edit token', count: isChanged(token) ? 1 : undefined },
  ...(canMerge.value
    ? [{ value: 'merge' as Tab, label: 'Merge', count: merge.value ? 1 : undefined }]
    : []),
  { value: 'info' as Tab, label: 'Info' }
])
const consolidatable = computed(() => ['color', 'text', 'radius', 'shadow'].includes(token.group))
const facts = computed(() => {
  const ns = namespaceOf(token.parent ?? token.name)
  return [
    { label: 'Value', value: token.value },
    { label: 'Declared', value: declarationOf(token)?.split(' → ')[0] ?? '—' },
    { label: 'Namespace', value: `--${ns.prefix}*` },
    {
      label: 'Use as',
      value: [...utilitiesOf(token), `var(--${token.name})`].join(', ')
    },
    ...(token.parent ? [{ label: 'Carried by', value: `--${token.parent}` }] : [])
  ]
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="relative pr-8">
      <CopyRef
        class="absolute top-0 right-0"
        :what="`--${token.name}`"
        :text="() => tokenReference(token)"
      />
      <h3 class="font-mono text-ui font-semibold break-all">--{{ token.name }}</h3>
      <p class="mt-0.5 truncate text-ui text-subtle-foreground">
        {{ groupLabel(token.group) }} · used {{ usage.total }}× in {{ usage.files.length }} files
      </p>
    </header>

    <SegmentedControl v-model="tab" variant="contained" class="[&>*]:flex-1" :options="tabs" />

    <!-- Edit token: its value, everywhere -->
    <section v-if="tab === 'edit'" class="flex flex-col gap-3">
      <TokenControl v-if="!merge" :token />
      <p v-else class="text-ui text-subtle-foreground">
        Merging into {{ shortName(tokenByName(merge)!) }}: its value no longer applies.
        <Button variant="link" size="sm" @click="tab = 'merge'">See merge</Button>
      </p>
      <p class="text-ui text-subtle-foreground">
        Changes it in all {{ usage.total }} places.
        <template v-if="token.parent"
          >Travels with --{{ token.parent }}, wherever that is used.</template
        >
      </p>
    </section>

    <!-- Merge: move every use onto another token, then remove this one -->
    <section v-else-if="tab === 'merge'" class="flex flex-col gap-3">
      <Select
        :model-value="merge ?? ''"
        size="sm"
        label="Merge into"
        :options="mergeOptions"
        @update:model-value="(v: string) => mergeToken(token, tokenByName(v) ?? null)"
      />
      <p class="text-ui text-subtle-foreground">
        {{
          merge
            ? `All ${usage.total} uses switch to ${shortName(tokenByName(merge)!)}, and ${shortName(token)} is deleted on publish.`
            : 'Replaces every use with another token, then deletes this one.'
        }}
      </p>
      <Button
        v-if="consolidatable"
        size="sm"
        class="self-start"
        @click="startConsolidate(token.group as ConsolidateGroup)"
        ><Combine :size="13" />Consolidate all {{ groupLabel(token.group).toLowerCase() }}</Button
      >
    </section>

    <!-- Info: where it's declared and used -->
    <template v-else>
      <section class="flex flex-col">
        <div
          v-for="r in facts"
          :key="r.label"
          class="flex items-start gap-2 border-t border-border-default py-2 text-ui"
        >
          <span class="w-20 shrink-0 text-muted-foreground">{{ r.label }}</span>
          <span class="min-w-0 flex-1 font-mono break-all">{{ r.value }}</span>
        </div>
      </section>
      <UsageList :usage />
    </template>
  </div>
</template>
