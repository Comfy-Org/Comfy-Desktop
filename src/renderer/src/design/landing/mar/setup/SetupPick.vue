<script setup lang="ts" generic="T extends string">
import { computed, type Component } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { cn } from '../../ui/cn'
import { fieldVariants } from '../../ui/field.variants'
import { floatingSurface, menuItem } from '../../ui/menu.styles'
import { PORTAL_TO } from '../../ui/portal'

/**
 * A setup field that picks one of a few options (Source, Hardware, Where
 * it is), as Desktop's Change setup draws it (Comfy-Desktop#2176): a full
 * width field with the picked option's icon and name, and a menu where
 * each option has its icon, name and one short line. The DS menu: the
 * picked row is filled, no check, rows 2px apart.
 */
export interface PickOption<V extends string = string> {
  value: V
  label: string
  description?: string
  icon?: Component
  /** A small uppercase tag after the name (Recommended). */
  badge?: string
}

const { options, label } = defineProps<{ options: PickOption<T>[]; label: string }>()
const model = defineModel<T>({ required: true })
const picked = computed(() => options.find((o) => o.value === model.value) ?? options[0])
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        :aria-label="label"
        :class="
          cn(
            fieldVariants({ size: 'lg' }),
            'mss-pick w-full cursor-pointer gap-2.5 pr-2.5 text-left outline-none focus-visible:border-border-focus data-[state=open]:border-border-strong'
          )
        "
      >
        <component
          :is="picked?.icon"
          v-if="picked?.icon"
          :size="15"
          class="shrink-0 text-muted-foreground"
        />
        <span class="min-w-0 flex-1 truncate">{{ picked?.label }}</span>
        <ChevronDown :size="14" class="shrink-0 text-subtle-foreground" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuPortal :to="PORTAL_TO">
      <DropdownMenuContent
        align="start"
        :side-offset="6"
        :class="cn(floatingSurface, 'mss-pick-menu z-[90] flex flex-col gap-0.5')"
      >
        <DropdownMenuRadioGroup v-model="model">
          <DropdownMenuRadioItem
            v-for="o in options"
            :key="o.value"
            :value="o.value"
            :class="
              cn(
                menuItem,
                'mss-pick-item items-start py-2 data-[state=checked]:bg-secondary-background'
              )
            "
          >
            <component :is="o.icon" v-if="o.icon" :size="15" class="mt-0.5" />
            <span class="grid min-w-0 gap-0.5">
              <span class="flex items-center gap-2"
                >{{ o.label }}<span v-if="o.badge" class="mss-pick-badge">{{ o.badge }}</span></span
              >
              <span v-if="o.description" class="text-xs text-muted-foreground">{{
                o.description
              }}</span>
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<style>
.mss-pick-menu {
  width: var(--reka-dropdown-menu-trigger-width);
}
.mss-pick-menu [role='group'] {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mss-pick-badge {
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in oklch, var(--color-base-foreground) 16%, transparent);
  color: var(--color-muted-foreground);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 14px;
  text-transform: uppercase;
}
</style>
