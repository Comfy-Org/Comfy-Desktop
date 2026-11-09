<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  FolderInput,
  Image,
  ListFilter,
  Search,
  Tag,
  X
} from 'lucide-vue-next'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from 'reka-ui'
import { cn } from '../../ui/cn'
import { fieldVariants } from '../../ui/field.variants'
import { PORTAL_TO } from '../../ui/portal'
import { activeFilters, noFilter, type AssetFilter, type AssetType } from '../assets/assetFilters'

/**
 * Media Assets' filter menu, as ComfyUI ships it (MediaAssetFilterMenu,
 * ComfyUI_frontend#14196): a "Filter by…" field, then Attribute with Media
 * type and Date nested, Date as presets. Tags join them (Better Asset
 * Management Phase 1). A solid menu, the design system's, so it never
 * blends into the panel behind it. No pills: the trigger says a filter is
 * on, and Clear filters closes the menu.
 *
 * Desktop's Filters uses the same menu behind a labelled field with a
 * count, adds Source (no tabs split it there) and a custom date range,
 * and names its types "More types" since Type sits in the toolbar.
 */
const {
  types,
  tags,
  field = false,
  source = false,
  range = false,
  typesLabel = 'Media type'
} = defineProps<{
  types: readonly { value: AssetType; label: string }[]
  tags: string[]
  /** Desktop's labelled trigger instead of the panel's icon. */
  field?: boolean
  source?: boolean
  range?: boolean
  typesLabel?: string
}>()
const f = defineModel<AssetFilter>({ required: true })

const DATES = [
  { value: 'today', label: 'Today', days: 0 },
  { value: 'week', label: 'Past week', days: 7 },
  { value: 'month', label: 'Past month', days: 30 },
  { value: 'year', label: 'This year', days: 365 }
] as const
const ago = (days: number): string =>
  new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
const date = computed(() =>
  f.value.to
    ? 'custom'
    : (DATES.find((d) => f.value.from === ago(d.days))?.value ?? (f.value.from ? 'custom' : ''))
)
const SOURCES = [
  { value: 'generated', label: 'Generated' },
  { value: 'imported', label: 'Imported' }
] as const
function setSource(v: AssetFilter['source']): void {
  f.value = { ...f.value, source: f.value.source === v ? 'all' : v }
}
function setDate(v: string): void {
  const d = DATES.find((x) => x.value === v)
  f.value = { ...f.value, from: d && date.value !== v ? ago(d.days) : '', to: '' }
}
const toggle = <T,>(list: T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

const q = ref('')
const match = (s: string): boolean => s.toLowerCase().includes(q.value.trim().toLowerCase())
const found = computed(() => ({
  sources: source ? SOURCES.filter((x) => match(x.label)) : [],
  types: types.filter((t) => match(t.label)),
  dates: DATES.filter((d) => match(d.label)),
  tags: tags.filter(match)
}))
const searching = computed(() => !!q.value.trim())
</script>

<template>
  <DropdownMenuRoot :modal="false" @update:open="(o) => !o && (q = '')">
    <DropdownMenuTrigger as-child>
      <button
        v-if="field"
        type="button"
        :class="
          cn(
            fieldVariants({}),
            'w-auto cursor-pointer gap-2 pr-2 outline-none focus-visible:border-border-focus data-[state=open]:border-border-strong'
          )
        "
        aria-label="Filters"
      >
        <ListFilter :size="14" class="shrink-0 text-subtle-foreground" />
        <span class="aff-label">Filters</span>
        <span v-if="activeFilters(f)" class="aff-badge">{{ activeFilters(f) }}</span>
        <ChevronDown :size="13" class="aff-chev ml-1 shrink-0 text-subtle-foreground" />
      </button>
      <button
        v-else
        type="button"
        class="rp-icon is-field"
        title="Filter by"
        aria-label="Filter by"
      >
        <ListFilter :size="15" /><i v-if="activeFilters(f)" class="rp-dot" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuPortal :to="PORTAL_TO">
      <DropdownMenuContent align="end" :side-offset="6" class="proto-ui afm">
        <label class="afm-search">
          <Search :size="14" />
          <input v-model="q" placeholder="Filter by..." aria-label="Filter by" @keydown.stop />
        </label>
        <DropdownMenuSeparator class="afm-sep" />

        <template v-if="searching">
          <template v-if="found.sources.length">
            <DropdownMenuLabel class="afm-label">Source</DropdownMenuLabel>
            <DropdownMenuRadioGroup :model-value="f.source">
              <DropdownMenuRadioItem
                v-for="x in found.sources"
                :key="x.value"
                class="afm-item"
                :value="x.value"
                @select.prevent="setSource(x.value)"
              >
                <span class="afm-grow">{{ x.label }}</span>
                <DropdownMenuItemIndicator><Check :size="16" /></DropdownMenuItemIndicator>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </template>
          <template v-if="found.types.length">
            <DropdownMenuLabel class="afm-label">{{ typesLabel }}</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              v-for="t in found.types"
              :key="t.value"
              class="afm-item"
              :model-value="f.types.includes(t.value)"
              @select.prevent="f = { ...f, types: toggle(f.types, t.value) }"
            >
              <span class="afm-grow">{{ t.label }}</span>
              <DropdownMenuItemIndicator><Check :size="16" /></DropdownMenuItemIndicator>
            </DropdownMenuCheckboxItem>
          </template>
          <template v-if="found.dates.length">
            <DropdownMenuLabel class="afm-label">Date</DropdownMenuLabel>
            <DropdownMenuRadioGroup :model-value="date">
              <DropdownMenuRadioItem
                v-for="d in found.dates"
                :key="d.value"
                class="afm-item"
                :value="d.value"
                @select.prevent="setDate(d.value)"
              >
                <span class="afm-grow">{{ d.label }}</span>
                <DropdownMenuItemIndicator><Check :size="16" /></DropdownMenuItemIndicator>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </template>
          <template v-if="found.tags.length">
            <DropdownMenuLabel class="afm-label">Tag</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              v-for="t in found.tags"
              :key="t"
              class="afm-item"
              :model-value="f.tags.includes(t)"
              @select.prevent="f = { ...f, tags: toggle(f.tags, t) }"
            >
              <span class="afm-grow">{{ t }}</span>
              <DropdownMenuItemIndicator><Check :size="16" /></DropdownMenuItemIndicator>
            </DropdownMenuCheckboxItem>
          </template>
          <p
            v-if="
              !found.sources.length &&
              !found.types.length &&
              !found.dates.length &&
              !found.tags.length
            "
            class="afm-none"
          >
            No matching filters
          </p>
        </template>

        <template v-else>
          <DropdownMenuLabel class="afm-label">Attribute</DropdownMenuLabel>
          <DropdownMenuSub v-if="source">
            <DropdownMenuSubTrigger class="afm-item">
              <FolderInput :size="16" class="afm-icon" /><span class="afm-grow">Source</span
              ><ChevronRight :size="16" class="afm-icon" />
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal :to="PORTAL_TO">
              <DropdownMenuSubContent :side-offset="8" :align-offset="-9" class="proto-ui afm">
                <DropdownMenuRadioGroup :model-value="f.source">
                  <DropdownMenuRadioItem
                    v-for="x in SOURCES"
                    :key="x.value"
                    class="afm-item"
                    :value="x.value"
                    @select.prevent="setSource(x.value)"
                  >
                    <span class="afm-grow">{{ x.label }}</span>
                    <DropdownMenuItemIndicator><Check :size="16" /></DropdownMenuItemIndicator>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger class="afm-item">
              <Image :size="16" class="afm-icon" /><span class="afm-grow">{{ typesLabel }}</span
              ><ChevronRight :size="16" class="afm-icon" />
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal :to="PORTAL_TO">
              <DropdownMenuSubContent :side-offset="8" :align-offset="-9" class="proto-ui afm">
                <DropdownMenuCheckboxItem
                  v-for="t in types"
                  :key="t.value"
                  class="afm-item"
                  :model-value="f.types.includes(t.value)"
                  @select.prevent="f = { ...f, types: toggle(f.types, t.value) }"
                >
                  <span class="afm-grow">{{ t.label }}</span>
                  <DropdownMenuItemIndicator><Check :size="16" /></DropdownMenuItemIndicator>
                </DropdownMenuCheckboxItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger class="afm-item">
              <Calendar :size="16" class="afm-icon" /><span class="afm-grow">Date</span
              ><ChevronRight :size="16" class="afm-icon" />
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal :to="PORTAL_TO">
              <DropdownMenuSubContent :side-offset="8" :align-offset="-9" class="proto-ui afm">
                <DropdownMenuRadioGroup :model-value="date">
                  <DropdownMenuRadioItem
                    v-for="d in DATES"
                    :key="d.value"
                    class="afm-item"
                    :value="d.value"
                    @select.prevent="setDate(d.value)"
                  >
                    <span class="afm-grow">{{ d.label }}</span>
                    <DropdownMenuItemIndicator><Check :size="16" /></DropdownMenuItemIndicator>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <template v-if="range">
                  <DropdownMenuSeparator class="afm-sep" />
                  <DropdownMenuLabel class="afm-label">Custom range</DropdownMenuLabel>
                  <div class="afm-range" @keydown.stop>
                    <label
                      >From<input
                        type="date"
                        :value="f.from"
                        :max="f.to || undefined"
                        @input="f = { ...f, from: ($event.target as HTMLInputElement).value }"
                    /></label>
                    <label
                      >To<input
                        type="date"
                        :value="f.to"
                        :min="f.from || undefined"
                        @input="f = { ...f, to: ($event.target as HTMLInputElement).value }"
                    /></label>
                  </div>
                </template>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub v-if="tags.length">
            <DropdownMenuSubTrigger class="afm-item">
              <Tag :size="16" class="afm-icon" /><span class="afm-grow">Tag</span
              ><ChevronRight :size="16" class="afm-icon" />
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal :to="PORTAL_TO">
              <DropdownMenuSubContent :side-offset="8" :align-offset="-9" class="proto-ui afm">
                <DropdownMenuCheckboxItem
                  v-for="t in tags"
                  :key="t"
                  class="afm-item"
                  :model-value="f.tags.includes(t)"
                  @select.prevent="f = { ...f, tags: toggle(f.tags, t) }"
                >
                  <span class="afm-grow">{{ t }}</span>
                  <DropdownMenuItemIndicator><Check :size="16" /></DropdownMenuItemIndicator>
                </DropdownMenuCheckboxItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </template>
        <template v-if="activeFilters(f)">
          <DropdownMenuSeparator class="afm-sep" />
          <DropdownMenuItem class="afm-item is-muted" @select.prevent="f = noFilter()">
            <X :size="16" class="afm-icon" /><span class="afm-grow">Clear filters</span>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<style>
/* The design system's menu (menuStyles.ts): the page's own background,
   solid, with a border and a large shadow, so it stands off the panel. */
/* Doubled class: it has to outrank the glass menus in layers.css. */
:root[data-mar-ui='on'] .afm.afm[role='menu'],
.afm[role='menu'] {
  z-index: 60;
  min-width: 192px;
  padding: 4px;
  border: 1px solid color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  border-radius: 10px;
  background: var(--color-content-background);
  backdrop-filter: none;
  box-shadow:
    0 10px 15px -3px rgb(0 0 0 / 0.4),
    0 4px 6px -4px rgb(0 0 0 / 0.4);
  color: var(--color-base-foreground);
  font-size: 13px;
}
.afm-search {
  display: flex;
  height: 32px;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .afm-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 13px;
  outline: none;
}
.afm-search input::placeholder {
  color: var(--color-muted-foreground);
}
.afm-sep {
  height: 1px;
  margin: 4px 0;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.afm-label {
  padding: 6px 12px 4px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 600;
}
:root[data-mar-ui='on'] .afm .afm-item,
.afm .afm-item {
  display: flex;
  min-height: 32px;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 6px;
  outline: none;
  cursor: default;
}
:root[data-mar-ui='on'] .afm .afm-item[data-state='checked'] {
  background-color: transparent;
  box-shadow: none;
}
:root[data-mar-ui='on'] .afm .afm-item[data-highlighted],
:root[data-mar-ui='on'] .afm .afm-item[data-state='open'] {
  background-color: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  box-shadow: none;
}
.afm-grow {
  flex: 1;
  text-align: left;
}
.afm-icon {
  flex: none;
  color: var(--color-muted-foreground);
}
.afm .afm-item.is-muted {
  color: var(--color-muted-foreground);
}
.afm-range {
  display: grid;
  gap: 6px;
  padding: 2px 12px 8px;
}
.afm-range label {
  display: grid;
  grid-template-columns: 40px 1fr;
  align-items: center;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .afm-range input {
  height: 28px;
  padding: 0 8px;
  border: 1px solid color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  border-radius: 6px;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 12px;
  color-scheme: dark light;
}
.aff-badge {
  display: inline-flex;
  min-width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.afm-none {
  padding: 6px 12px;
  color: var(--color-muted-foreground);
}
</style>
