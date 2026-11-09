<script setup lang="ts">
import { computed } from 'vue'
import { Check, LayoutDashboard, LayoutGrid, Minus, Plus } from 'lucide-vue-next'
import { DropdownMenuItem, DropdownMenuRoot, DropdownMenuSub, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import DropdownMenuSubContent from '../../ui/DropdownMenuSubContent.vue'
import DropdownMenuSubTrigger from '../../ui/DropdownMenuSubTrigger.vue'
import { cn } from '../../ui/cn'
import { menuItem } from '../../ui/menu.styles'

/**
 * The Layout menu of the Assets page and the Apps page: LAYOUT with
 * Masonry and Grid as icon tabs beside it (the picked one with its name); Size as − a stepped bar +; then,
 * where the page has them (Assets), Sort by as a submenu and SHOW, what a
 * card carries. Every title is the uppercase label.
 */
export type AssetView = 'masonry' | 'grid'
const view = defineModel<AssetView>('view', { required: true })
const size = defineModel<number>('size', { required: true })
const sort = defineModel<string>('sort')
const showName = defineModel<boolean>('showName')
const showDetails = defineModel<boolean>('showDetails')
const { sorts = [] } = defineProps<{ sorts?: { value: string; label: string }[] }>()

const SIZES = 3
const VIEWS = [
  { value: 'masonry', label: 'Masonry', icon: LayoutDashboard },
  { value: 'grid', label: 'Grid', icon: LayoutGrid }
] as const
const sortLabel = computed(() => sorts.find((s) => s.value === sort.value)?.label ?? '')
const setSize = (n: number): void => {
  size.value = Math.min(SIZES, Math.max(1, n))
}
const SHOW = computed(() =>
  showName.value === undefined
    ? []
    : [
        { label: 'File name', on: showName },
        { label: 'File details', on: showDetails }
      ]
)
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger as-child>
      <button type="button" class="alm-trigger" aria-label="Layout" title="Layout">
        <LayoutGrid :size="15" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="alm w-64">
      <div class="alm-head">
        <p class="alm-label">Layout</p>
        <div class="alm-views" role="radiogroup" aria-label="View">
          <button
            v-for="v in VIEWS"
            :key="v.value"
            type="button"
            role="radio"
            :aria-checked="view === v.value"
            :aria-label="v.label"
            :title="v.label"
            :class="cn('alm-view', view === v.value && 'is-on')"
            @click="view = v.value"
          >
            <component :is="v.icon" :size="15" /><span v-if="view === v.value">{{ v.label }}</span>
          </button>
        </div>
      </div>
      <div class="alm-size">
        <span class="alm-cap">Size</span>
        <button
          type="button"
          class="alm-size-btn"
          aria-label="Smaller"
          :disabled="size <= 1"
          @click="setSize(size - 1)"
        >
          <Minus :size="13" />
        </button>
        <div class="alm-size-bar" role="group" aria-label="Size">
          <button
            v-for="n in SIZES"
            :key="n"
            type="button"
            :class="n <= size && 'is-on'"
            :aria-label="`Size ${n}`"
            :aria-pressed="n === size"
            @click="setSize(n)"
          />
        </div>
        <button
          type="button"
          class="alm-size-btn"
          aria-label="Bigger"
          :disabled="size >= SIZES"
          @click="setSize(size + 1)"
        >
          <Plus :size="13" />
        </button>
      </div>
      <DropdownMenuSub v-if="sorts.length">
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
      <template v-if="SHOW.length">
        <DropdownMenuSeparator class="alm-sep" />
        <p class="alm-label">Show</p>
        <DropdownMenuItem
          v-for="d in SHOW"
          :key="d.label"
          :class="cn(menuItem, 'alm-row')"
          @select.prevent="d.on.value = !d.on.value"
        >
          <span class="flex-1">{{ d.label }}</span
          ><Check v-if="d.on.value" :size="14" />
        </DropdownMenuItem>
      </template>
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
:root .alm.alm.proto-ui.proto-ui .alm-sep {
  margin: 6px -6px;
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
  gap: 6px;
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
