<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, LayoutGrid, Minus, Plus } from 'lucide-vue-next'
import { DropdownMenuItem, DropdownMenuRoot, DropdownMenuSub, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuSubContent from '../../ui/DropdownMenuSubContent.vue'
import DropdownMenuSubTrigger from '../../ui/DropdownMenuSubTrigger.vue'
import { cn } from '../../ui/cn'
import { menuItem } from '../../ui/menu.styles'
import { WALLS, type AssetWall } from './assetView'

/**
 * The Layout menu of the Assets page and the Apps page: LAYOUT with
 * Masonry and Grid as icon tabs beside it (the picked one with its name;
 * Assets adds masonry in rows); Size as − a stepped bar +; then, where the
 * page has them (Assets), Sort by, Group by and Show, each a submenu
 * with its value on the row. Every title is the uppercase label.
 */
export type AssetView = AssetWall
const view = defineModel<AssetView>('view', { required: true })
const size = defineModel<number>('size')
const sort = defineModel<string>('sort')
// Unset stays undefined (a Boolean prop would read false): no Show row.
const showName = defineModel<boolean>('showName', { default: undefined })
const showDetails = defineModel<boolean>('showDetails', { default: undefined })
const showLabels = defineModel<boolean>('showLabels', { default: undefined })
const group = defineModel<string>('group')
const {
  sorts = [],
  groups = [],
  views = ['masonry', 'grid']
} = defineProps<{
  sorts?: { value: string; label: string }[]
  groups?: { value: string; label: string }[]
  /** Which layouts the page offers, in order. */
  views?: AssetView[]
}>()

// One submenu at a time: a quick sweep down the list could leave the
// ones it crossed open, stacked beside each other (as AssetFilterMenu).
const sub = ref('')
const only = (key: string, open: boolean): void => {
  if (open) sub.value = key
  else if (sub.value === key) sub.value = ''
}
const SIZES = 3
const VIEWS = computed(() => WALLS.filter((w) => views.includes(w.value)))
const sortLabel = computed(() => sorts.find((s) => s.value === sort.value)?.label ?? '')
const groupLabel = computed(() => groups.find((g) => g.value === group.value)?.label ?? '')
const setSize = (n: number): void => {
  size.value = Math.min(SIZES, Math.max(1, n))
}
const SHOW = computed(() =>
  showName.value === undefined
    ? []
    : [
        { label: 'File name', on: showName },
        { label: 'File details', on: showDetails },
        ...(showLabels.value === undefined ? [] : [{ label: 'Labels', on: showLabels }])
      ]
)
/** Show's row says what is on: All, None, or the ones on. */
const showLabel = computed(() => {
  const on = SHOW.value.filter((d) => d.on.value)
  if (on.length === SHOW.value.length) return 'All'
  return on.length
    ? on.map((d) => d.label.replace(/^File (\w)/, (_, c: string) => c.toUpperCase())).join(', ')
    : 'None'
})
</script>

<template>
  <DropdownMenuRoot :modal="false" @update:open="(o) => !o && (sub = '')">
    <DropdownMenuTrigger as-child>
      <button type="button" class="alm-trigger" aria-label="Layout" title="Layout">
        <LayoutGrid :size="15" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="alm w-64">
      <!-- One layout (Explore's cards): no LAYOUT line, Size leads. -->
      <div v-if="VIEWS.length > 1" class="alm-head">
        <p class="alm-label">Layout</p>
        <div class="alm-views" role="radiogroup" aria-label="View">
          <button
            v-for="v in VIEWS"
            :key="v.value"
            type="button"
            role="radio"
            :aria-checked="view === v.value"
            :aria-label="views.length > 2 ? v.title : v.label"
            :title="views.length > 2 ? v.title : v.label"
            :class="cn('alm-view', view === v.value && 'is-on')"
            @click="view = v.value"
          >
            <component :is="v.icon" :size="15" /><span class="mar-tab-grow">{{ v.label }}</span>
          </button>
        </div>
      </div>
      <div v-if="size !== undefined" class="alm-size">
        <span class="alm-cap">Size</span>
        <button
          type="button"
          class="alm-size-btn"
          aria-label="Smaller"
          :disabled="size! <= 1"
          @click="setSize(size! - 1)"
        >
          <Minus :size="13" />
        </button>
        <div class="alm-size-bar" role="group" aria-label="Size">
          <button
            v-for="n in SIZES"
            :key="n"
            type="button"
            :class="n <= size! && 'is-on'"
            :aria-label="`Size ${n}`"
            :aria-pressed="n === size"
            @click="setSize(n)"
          />
        </div>
        <button
          type="button"
          class="alm-size-btn"
          aria-label="Bigger"
          :disabled="size! >= SIZES"
          @click="setSize(size! + 1)"
        >
          <Plus :size="13" />
        </button>
      </div>
      <DropdownMenuSub
        v-if="sorts.length"
        :open="sub === 'sort'"
        @update:open="only('sort', $event)"
      >
        <DropdownMenuSubTrigger class="alm-row"
          ><span class="alm-cap flex-1">Sort by</span
          ><span class="text-subtle-foreground">{{ sortLabel }}</span></DropdownMenuSubTrigger
        >
        <DropdownMenuSubContent>
          <DropdownMenuItem
            v-for="o in sorts"
            :key="o.value"
            :class="menuItem"
            @select="sort = o.value"
          >
            <span class="flex-1">{{ o.label }}</span
            ><Check v-if="sort === o.value" :size="14" />
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub
        v-if="groups.length"
        :open="sub === 'group'"
        @update:open="only('group', $event)"
      >
        <DropdownMenuSubTrigger class="alm-row"
          ><span class="alm-cap flex-1">Group by</span
          ><span class="text-subtle-foreground">{{ groupLabel }}</span></DropdownMenuSubTrigger
        >
        <DropdownMenuSubContent>
          <DropdownMenuItem
            v-for="o in groups"
            :key="o.value"
            :class="menuItem"
            @select="group = o.value"
          >
            <span class="flex-1">{{ o.label }}</span
            ><Check v-if="group === o.value" :size="14" />
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub
        v-if="SHOW.length"
        :open="sub === 'show'"
        @update:open="only('show', $event)"
      >
        <DropdownMenuSubTrigger class="alm-row"
          ><span class="alm-cap flex-1">Show</span
          ><span class="alm-val">{{ showLabel }}</span></DropdownMenuSubTrigger
        >
        <DropdownMenuSubContent>
          <DropdownMenuItem
            v-for="d in SHOW"
            :key="d.label"
            :class="menuItem"
            @select.prevent="d.on.value = !d.on.value"
          >
            <span class="flex-1">{{ d.label }}</span
            ><Check v-if="d.on.value" :size="14" />
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .alm-trigger {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .alm-trigger:hover,
:root .proto-ui.proto-ui.proto-ui .alm-trigger[data-state='open'] {
  background: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
}
:root .alm.alm.proto-ui.proto-ui .alm-label {
  padding: 8px 10px 4px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
/* A long Show value stays on one line. */
.alm-val {
  max-width: 110px;
  overflow: hidden;
  color: var(--color-subtle-foreground);
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* LAYOUT, then its views as tabs on the same line. */
.alm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 4px 4px 0;
}
:root .alm.alm.proto-ui.proto-ui .alm-head .alm-label {
  padding-block: 0;
}
.alm-views {
  display: flex;
  padding: 2px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
:root .alm.alm.proto-ui.proto-ui .alm-view {
  display: inline-flex;
  min-width: 30px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 400;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted-foreground);
}
:root .alm.alm.proto-ui.proto-ui .alm-view:hover {
  color: var(--color-base-foreground);
}
:root .alm.alm.proto-ui.proto-ui .alm-view.is-on {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  color: var(--color-base-foreground);
}
/* Size: − a stepped bar +. */
:root .alm.alm.proto-ui.proto-ui .alm-size {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 6px;
  font-size: 13px;
}
.alm-size > span {
  flex: 1;
}
:root .alm.alm.proto-ui.proto-ui .alm-size-btn {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
:root .alm.alm.proto-ui.proto-ui .alm-size-btn:hover:not(:disabled) {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
:root .alm.alm.proto-ui.proto-ui .alm-size-btn:disabled {
  opacity: 0.35;
}
.alm-size-bar {
  display: flex;
  width: 96px;
  height: 18px;
  overflow: hidden;
  border-radius: 6px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
:root .alm.alm.proto-ui.proto-ui .alm-size-bar button {
  flex: 1;
  padding: 0;
  border-radius: 0;
  background: transparent;
}
:root .alm.alm.proto-ui.proto-ui .alm-size-bar button + button {
  box-shadow: inset 1px 0 0 color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
:root .alm.alm.proto-ui.proto-ui .alm-size-bar button.is-on {
  background: color-mix(in oklch, var(--color-base-foreground) 38%, transparent);
}
:root .alm.alm.proto-ui.proto-ui .alm-row {
  background: transparent;
  box-shadow: none;
  font-size: 13px;
}
/* Size and Sort by read as the section labels. */
:root .alm.alm.proto-ui.proto-ui .alm-cap {
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
:root .alm.alm.proto-ui.proto-ui .alm-row[data-highlighted],
:root .alm.alm.proto-ui.proto-ui .alm-row[data-state='open'] {
  background: var(--color-secondary-background);
  box-shadow: none;
}
</style>
