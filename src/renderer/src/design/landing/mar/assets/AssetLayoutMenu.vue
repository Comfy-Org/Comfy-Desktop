<script setup lang="ts">
import { computed } from 'vue'
import { Check, LayoutDashboard, LayoutGrid, Minus, Plus, TableOfContents } from 'lucide-vue-next'
import { DropdownMenuItem, DropdownMenuRoot, DropdownMenuSub, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import DropdownMenuSubContent from '../../ui/DropdownMenuSubContent.vue'
import DropdownMenuSubTrigger from '../../ui/DropdownMenuSubTrigger.vue'
import { cn } from '../../ui/cn'
import { menuItem } from '../../ui/menu.styles'

/**
 * The Assets page's Layout menu, the same as the graph's Assets panel
 * (AssetsPanel.vue): LAYOUT as three views, icon over name; Size as − a
 * stepped bar +; Sort by as a submenu; then SHOW, what a card carries.
 * Section titles are uppercase; Size and Sort by stay sentence case.
 */
export type AssetView = 'masonry' | 'grid' | 'list'
const view = defineModel<AssetView>('view', { required: true })
const size = defineModel<number>('size', { required: true })
const sort = defineModel<string>('sort', { required: true })
const showName = defineModel<boolean>('showName', { required: true })
const showDetails = defineModel<boolean>('showDetails', { required: true })
const { sorts } = defineProps<{ sorts: { value: string; label: string }[] }>()

const SIZES = 3
const VIEWS = [
  { value: 'masonry', label: 'Masonry', icon: LayoutDashboard },
  { value: 'grid', label: 'Grid', icon: LayoutGrid },
  { value: 'list', label: 'List', icon: TableOfContents }
] as const
const sortLabel = computed(() => sorts.find((s) => s.value === sort.value)?.label ?? '')
const setSize = (n: number): void => {
  size.value = Math.min(SIZES, Math.max(1, n))
}
const SHOW = [
  { label: 'File name', on: showName },
  { label: 'File details', on: showDetails }
]
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger as-child>
      <button type="button" class="alm-trigger" aria-label="Layout" title="Layout">
        <LayoutGrid :size="15" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="alm w-64">
      <p class="alm-label">Layout</p>
      <div class="alm-views" role="radiogroup" aria-label="View">
        <button
          v-for="v in VIEWS"
          :key="v.value"
          type="button"
          role="radio"
          :aria-checked="view === v.value"
          :class="cn('alm-view', view === v.value && 'is-on')"
          @click="view = v.value"
        >
          <component :is="v.icon" :size="16" /><span>{{ v.label }}</span>
        </button>
      </div>
      <div v-if="view !== 'list'" class="alm-size">
        <span>Size</span>
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
      <DropdownMenuSub>
        <DropdownMenuSubTrigger class="alm-row"
          ><span class="flex-1">Sort by</span
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
.alm-views {
  display: flex;
  margin: 2px 0 4px;
  padding: 3px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
/* Each view: its icon over its name. */
:root .alm.alm.proto-ui.proto-ui .alm-view {
  display: flex;
  height: auto;
  line-height: 1.2;
  font-weight: 400;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 4px 7px;
  border-radius: 8px;
  background: transparent;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .alm.alm.proto-ui.proto-ui .alm-view:hover {
  color: var(--color-base-foreground);
}
:root .alm.alm.proto-ui.proto-ui .alm-view.is-on {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  color: var(--color-base-foreground);
}
/* Size: − a stepped bar +. */
:root .alm.alm.proto-ui.proto-ui .alm-size {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 4px;
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
  font-size: 13px;
}
:root .alm.alm.proto-ui.proto-ui .alm-row[data-highlighted],
:root .alm.alm.proto-ui.proto-ui .alm-row[data-state='open'] {
  background: var(--color-secondary-background);
}
</style>
