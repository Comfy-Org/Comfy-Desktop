<script setup lang="ts">
import { Check, MoreHorizontal } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuSub, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import DropdownMenuSubContent from '../../ui/DropdownMenuSubContent.vue'
import DropdownMenuSubTrigger from '../../ui/DropdownMenuSubTrigger.vue'
import Tooltip from '../../ui/Tooltip.vue'
import type { MenuLine } from './menu'

/** An item's ⋯ menu (Mar's pages): smoked glass, a second panel for
 *  Move to project, the destructive line last and red. */
const {
  lines,
  label = 'More actions',
  onMedia,
  side = 'bottom'
} = defineProps<{
  lines: MenuLine[]
  label?: string
  onMedia?: boolean
  side?: 'top' | 'bottom'
}>()
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <DropdownMenuRoot v-model:open="open" :modal="false">
    <DropdownMenuTrigger as-child>
      <slot name="trigger"
        ><button
          type="button"
          class="mar-kebab"
          :class="[onMedia && 'on-media', open && 'is-open']"
          :aria-label="label"
          @click.stop
          @dblclick.stop
        >
          <MoreHorizontal :size="15" /></button
      ></slot>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" :side="side" :side-offset="6" class="w-56">
      <template v-for="(l, i) in lines" :key="i">
        <DropdownMenuSeparator v-if="l === 'sep'" />
        <p v-else-if="'note' in l" class="mar-menu-note">{{ l.note }}</p>
        <DropdownMenuSub v-else-if="l.sub">
          <DropdownMenuSubTrigger
            ><component :is="l.icon" v-if="l.icon" :size="15" />{{
              l.label
            }}</DropdownMenuSubTrigger
          >
          <DropdownMenuSubContent>
            <template v-for="(s, j) in l.sub" :key="j">
              <DropdownMenuItem :disabled="s.disabled" @select="s.run?.()">
                <component :is="s.icon" v-if="s.icon" :size="15" />
                <span class="flex-1 truncate">{{ s.label }}</span>
                <Check v-if="s.checked" :size="14" />
              </DropdownMenuItem>
            </template>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <Tooltip v-else :content="l.title ?? ''" :disabled="!l.title" side="left">
          <DropdownMenuItem
            :disabled="l.disabled"
            :class="[l.danger && 'mar-menu-danger', l.title && 'mar-menu-why']"
            @select="l.run?.()"
          >
            <component :is="l.icon" v-if="l.icon" :size="15" />
            <span class="flex-1 truncate">{{ l.label }}</span>
            <kbd v-if="l.hint" class="mar-menu-hint">{{ l.hint }}</kbd>
          </DropdownMenuItem>
        </Tooltip>
      </template>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-kebab {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 8px;
  color: var(--color-muted-foreground);
  transition:
    background-color 140ms ease,
    opacity 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-kebab:hover,
:root .proto-ui.proto-ui.proto-ui .mar-kebab.is-open {
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-kebab.on-media {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: var(--color-media-overlay);
  backdrop-filter: blur(12px);
  color: rgb(255 255 255 / 0.92);
}
.mar-menu-danger,
.mar-menu-danger > svg {
  color: var(--color-status-danger) !important;
}
/* A greyed line still takes the hover, so its tooltip can say why. */
:root .proto-ui.proto-ui.proto-ui .mar-menu-why[data-disabled] {
  pointer-events: auto;
}
.mar-menu-note {
  margin: 0;
  padding: 6px 8px 4px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  line-height: 16px;
}
.mar-menu-hint {
  color: var(--color-subtle-foreground);
  font-family: inherit;
  font-size: 11px;
}
</style>
