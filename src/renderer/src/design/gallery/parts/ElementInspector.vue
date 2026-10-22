<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'
import { ArrowUpRight } from 'lucide-vue-next'
import Badge from '../../landing/ui/Badge.vue'
import Button from '../../landing/ui/Button.vue'
import SegmentedControl from '../../landing/ui/SegmentedControl.vue'
import Select from '../../landing/ui/Select.vue'
import PropControl from './PropControl.vue'
import TokenChip from './TokenChip.vue'
import { declaration, KIND_GROUP, PROP_LABEL, stateLabel, swapClass } from '../inspect/classes'
import { inspect, type TokenRow } from '../inspect/inspect'
import { selectToken, tick, tokenByName } from '../inspect/selection'
import { scopedActions } from '../inspect/actions'
import { componentReference } from '../reference'
import CopyRef from './CopyRef.vue'
import { usageOf } from '../inspect/usage'
import { CONTROLS, state, type PlaygroundKey } from '../playground'
import { shortName, tokensIn } from '../tokens'
import { tokenOptions } from '../tokenOptions'
import { componentUsage } from '../inspect/usage'
import UsageList from './UsageList.vue'
import { draft, isChanged, revertComponent, setSwap, swapFor, swapsOf } from '../tweaks'

/**
 * A selected element: the tokens behind each of its properties (swap one
 * for another, or open a token to change its value everywhere), what is
 * hardcoded, and its layout values.
 */
const { el } = defineProps<{ el: HTMLElement }>()

const info = computed(() => {
  void tick.value
  void draft.swaps.length
  const i = inspect(el)
  // Default state first, then hover, focus, …
  i.tokens.sort((a, b) => a.use.states.length - b.use.states.length)
  return i
})
// Root first, then each inner part that uses tokens.
const groups = computed(() =>
  [
    { label: 'Root', rows: info.value.tokens },
    ...info.value.parts.map((p) => ({ label: p.label, rows: p.tokens }))
  ].filter((g) => g.rows.length)
)
const playground = computed(
  () =>
    el.closest<HTMLElement>('[data-playground]')?.dataset.playground as PlaygroundKey | undefined
)

const canSwap = (r: TokenRow): boolean => !!(r.source && r.selector !== null)
// cva components publish into their variants file; others into their .vue.
const target = () => ({
  id: info.value.match?.component.id ?? info.value.kit!.file,
  file: info.value.match?.component.file ?? info.value.kit!.file
})
const key = (r: TokenRow) => ({
  component: target().id,
  axis: r.source!.axis,
  option: r.source!.option,
  from: r.use.cls
})
/** The token in effect for a row, after any draft swap. */
function current(r: TokenRow) {
  const s = canSwap(r) ? swapFor(key(r)) : undefined
  return (s && tokenByName(s.toToken)) || r.use.token
}
const options = (r: TokenRow) => tokenOptions(KIND_GROUP[r.use.kind])
function swap(r: TokenRow, name: string): void {
  const t = tokensIn(KIND_GROUP[r.use.kind]).find((x) => x.name === name)!
  setSwap({
    ...key(r),
    componentName: info.value.name,
    file: target().file,
    to: name === r.use.token.name ? r.use.cls : swapClass(r.use, t),
    fromToken: r.use.token.name,
    toToken: name,
    selector: `${r.selector}${r.stateSuffix}`,
    css: declaration(r.use.kind, t, r.use.opacity)
  })
}
// This component's draft: its swaps, plus value changes of tokens it uses.
const mine = computed(() => (info.value.kit || info.value.match ? swapsOf(target().id) : []))
const usedTokens = computed(() => [
  ...new Set(groups.value.flatMap((g) => g.rows.map((r) => current(r))).filter(isChanged))
])
const llmScope = computed(() => ({ tokens: usedTokens.value, swaps: mine.value, merges: [] }))
// Footer actions: copy / revert this component's changes.
watchEffect(() => {
  if (!info.value.kit && !info.value.match) return void (scopedActions.value = null)
  const id = target().id
  scopedActions.value = {
    label: info.value.name,
    changes: mine.value.length + usedTokens.value.length,
    scope: llmScope.value,
    revert: mine.value.length ? () => revertComponent(id) : undefined
  }
})
onBeforeUnmount(() => (scopedActions.value = null))
const usage = computed(() => (info.value.kit ? componentUsage(info.value.kit.name) : null))

// Preview (props: try variants, changes nothing) vs Tokens (edits the
// design system). Only stage specimens have props.
// Edit tokens (changes the design system), Variants (props: try variants,
// changes nothing; stage specimens only) and Info (layout, where used).
type Tab = 'tokens' | 'preview' | 'info'
const mode = ref<Tab>('tokens')
const tab = computed<Tab>({
  get: () => (mode.value === 'preview' && !playground.value ? 'tokens' : mode.value),
  set: (v) => (mode.value = v)
})
const tabs = computed(() => [
  { value: 'tokens' as Tab, label: 'Edit tokens', count: changeCount.value || undefined },
  ...(playground.value ? [{ value: 'preview' as Tab, label: 'Variants' }] : []),
  { value: 'info' as Tab, label: 'Info' }
])
// "variant primary · size md · ui/button.variants.ts": the variant parts
// go next to the tokens, the file stays in the header.
const detailParts = computed(() => info.value.detail?.split(' · ') ?? [])
const variantParts = computed(() => detailParts.value.filter((d) => !d.includes('/')))
const fileParts = computed(() => detailParts.value.filter((d) => d.includes('/')))
const changeCount = computed(() => mine.value.length + usedTokens.value.length)

const sourceLabel = (r: TokenRow): string =>
  !r.source
    ? 'Set at the call site or repeated in the file · not swappable'
    : r.source.axis === 'base'
      ? `Base · every ${info.value.name.toLowerCase()}`
      : r.source.axis === 'file'
        ? `ui/${r.source.option}`
        : `${r.source.axis} ${r.source.option}`
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="relative pr-8">
      <CopyRef
        class="absolute top-0 right-0"
        :what="info.name"
        :text="
          () =>
            componentReference(info.kit?.name ?? info.match?.component.name ?? info.name, {
              options: info.match?.options,
              rows: groups.flatMap((g) => g.rows)
            })
        "
      />
      <h3 class="text-ui font-semibold">{{ info.name }}</h3>
      <p class="mt-0.5 truncate text-ui text-subtle-foreground">
        {{
          [
            ...(playground ? fileParts : detailParts),
            usage && `used ${usage.total}× in ${usage.files.length} files`
          ]
            .filter(Boolean)
            .join(' · ')
        }}
      </p>
    </header>

    <SegmentedControl v-model="tab" variant="contained" class="[&>*]:flex-1" :options="tabs" />

    <!-- Preview: props drive the Playground only -->
    <section v-if="playground && tab === 'preview'" class="flex flex-col gap-4">
      <p class="text-ui text-subtle-foreground">Preview only. Doesn't change the design system.</p>
      <PropControl
        v-for="c in CONTROLS[playground]"
        :key="c.key"
        v-model="state[playground]![c.key]!"
        :control="c"
      />
    </section>

    <!-- Info: layout values and where the component is used -->
    <template v-else-if="tab === 'info'">
      <section>
        <h4 class="mb-2 text-ui font-semibold">Layout</h4>
        <div
          v-for="r in info.layout"
          :key="r.label"
          class="flex items-center gap-2 border-t border-border-default py-2 text-ui"
        >
          <span class="w-24 shrink-0 text-muted-foreground">{{ r.label }}</span>
          <span class="min-w-0 flex-1 truncate font-mono text-ui">{{ r.value }}</span>
          <Badge v-if="r.offGrid" variant="outline" size="sm">off grid</Badge>
          <span v-else-if="r.cls" class="truncate font-mono text-ui text-subtle-foreground">{{
            r.cls
          }}</span>
        </div>
      </section>
      <UsageList v-if="usage" :usage noun="instances" />
    </template>

    <!-- Tokens: edits the design system (into the draft) -->
    <template v-else>
      <section>
        <p
          v-if="playground && variantParts.length"
          class="mb-3 flex flex-wrap items-center gap-1.5 text-ui"
        >
          <Badge v-for="d in variantParts" :key="d" size="md">{{ d }}</Badge>
          <Button variant="link" size="sm" class="ml-auto" @click="tab = 'preview'">Change</Button>
        </p>
        <p v-if="!groups.length" class="text-ui text-subtle-foreground">
          No design tokens on this element.
        </p>
        <template v-for="group in groups" :key="group.label">
          <p
            v-if="groups.length > 1"
            class="mt-3 mb-1 text-ui font-medium tracking-wider text-subtle-foreground uppercase"
          >
            {{ group.label }}
          </p>
          <div
            v-for="r in group.rows"
            :key="group.label + r.use.cls"
            class="flex flex-col gap-2 border-t border-border-default py-3"
          >
            <div class="flex items-center gap-2">
              <span class="flex-1 text-ui">{{ PROP_LABEL[r.use.kind] }}</span>
              <Badge v-if="r.use.states.length" size="sm">{{ stateLabel(r.use.states) }}</Badge>
              <span v-if="r.use.opacity" class="text-ui text-subtle-foreground"
                >{{ r.use.opacity }}%</span
              >
            </div>
            <div class="flex items-center gap-2">
              <template v-if="canSwap(r)">
                <span
                  v-if="current(r).group === 'color'"
                  class="size-6 shrink-0 rounded-control border border-border-strong"
                  :style="{ background: `var(--${current(r).name})` }"
                />
                <Select
                  :model-value="current(r).name"
                  size="sm"
                  class="min-w-0 flex-1"
                  :options="options(r)"
                  @update:model-value="(v: string) => swap(r, v)"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="`Edit ${shortName(current(r))} everywhere`"
                  title="Edit this token everywhere"
                  @click="selectToken(current(r))"
                  ><ArrowUpRight :size="14"
                /></Button>
              </template>
              <TokenChip v-else :token="current(r)" />
            </div>
            <p class="flex items-center gap-2 text-ui text-subtle-foreground">
              <span class="flex-1 truncate">{{ sourceLabel(r) }}</span>
              <span>used in {{ usageOf(current(r)).files.length }} files</span>
            </p>
          </div>
        </template>
      </section>

      <section v-if="info.hardcoded.length">
        <h4 class="mb-1 text-ui font-semibold">Hardcoded</h4>
        <p class="mb-2 text-ui text-subtle-foreground">
          Literal values, not tokens. They can't be tweaked here until they become tokens.
        </p>
        <div
          v-for="r in info.hardcoded"
          :key="r.label"
          class="flex items-center gap-2 border-t border-border-default py-2 text-ui"
        >
          <span class="w-24 shrink-0 text-muted-foreground">{{ r.label }}</span>
          <span class="min-w-0 flex-1 truncate font-mono text-ui">{{ r.value }}</span>
          <span v-if="r.cls" class="truncate font-mono text-ui text-subtle-foreground">{{
            r.cls
          }}</span>
        </div>
      </section>
    </template>
  </div>
</template>
