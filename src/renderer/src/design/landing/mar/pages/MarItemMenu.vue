<script setup lang="ts">
import { ref, watch } from 'vue'
import { Check, MoreHorizontal } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuSub, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import DropdownMenuSubContent from '../../ui/DropdownMenuSubContent.vue'
import DropdownMenuSubTrigger from '../../ui/DropdownMenuSubTrigger.vue'
import Tooltip from '../../ui/Tooltip.vue'
import type { MenuAction, MenuLine } from './menu'

/** An item's ⋯ menu (Mar's pages): smoked glass, a second panel for
 *  Move to project, the destructive line last and red. */
const {
  lines,
  label = 'More actions',
  onMedia,
  side = 'bottom',
  align = 'end'
} = defineProps<{
  lines: MenuLine[]
  label?: string
  onMedia?: boolean
  side?: 'top' | 'bottom'
  /** Start where the item sits at the left edge of a panel. */
  align?: 'start' | 'end'
}>()
const open = defineModel<boolean>('open', { default: false })
// One submenu at a time: a quick sweep down the list could leave the
// ones it crossed open, stacked beside each other (as AssetFilterMenu).
const sub = ref(-1)
const only = (i: number, on: boolean): void => {
  if (on) sub.value = i
  else if (sub.value === i) sub.value = -1
}
// A line with `confirm` asks inside the menu: the panel becomes the
// question, so the answer sits where the click was.
const asking = ref<MenuAction | null>(null)
function pick(l: MenuAction, e: Event): void {
  if (!l.confirm) return l.run?.()
  e.preventDefault()
  asking.value = l
}
function answer(yes: boolean): void {
  const l = asking.value
  if (yes) l?.run?.()
  open.value = false
}
const vFocusAsk = { mounted: (el: HTMLElement) => requestAnimationFrame(() => el.focus()) }
watch(open, (o) => {
  if (o) return
  sub.value = -1
  setTimeout(() => (asking.value = null), 160)
})
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
    <DropdownMenuContent :align="align" :side="side" :side-offset="6" class="min-w-56">
      <div
        v-if="asking?.confirm"
        class="mar-menu-ask"
        role="alertdialog"
        :aria-label="asking.label"
      >
        <p class="mar-menu-ask-text">{{ asking.confirm.text }}</p>
        <span class="mar-menu-ask-actions">
          <button v-focus-ask type="button" class="mar-menu-ask-btn" @click="answer(false)">
            Cancel
          </button>
          <button type="button" class="mar-menu-ask-btn is-danger" @click="answer(true)">
            {{ asking.confirm.yes }}
          </button>
        </span>
      </div>
      <template v-else
        ><template v-for="(l, i) in lines" :key="i">
          <DropdownMenuSeparator v-if="l === 'sep'" />
          <p v-else-if="'note' in l" class="mar-menu-note">{{ l.note }}</p>
          <DropdownMenuSub v-else-if="l.sub" :open="sub === i" @update:open="only(i, $event)">
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
              @select="pick(l, $event)"
            >
              <component :is="l.icon" v-if="l.icon" :size="15" />
              <span class="flex-1 truncate">{{ l.label }}</span>
              <kbd v-if="l.hint" class="mar-menu-hint">{{ l.hint }}</kbd>
            </DropdownMenuItem>
          </Tooltip>
        </template>
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
.mar-menu-ask {
  display: flex;
  width: 224px;
  flex-direction: column;
  gap: 10px;
  padding: 8px;
}
.mar-menu-ask-text {
  margin: 0;
  color: var(--color-base-foreground);
  font-size: 13px;
  line-height: 18px;
}
.mar-menu-ask-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}
:root .proto-ui.proto-ui.proto-ui .mar-menu-ask-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--color-muted-foreground);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui .mar-menu-ask-btn:hover,
:root .proto-ui.proto-ui.proto-ui .mar-menu-ask-btn:focus-visible {
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-menu-ask-btn.is-danger {
  background: color-mix(in oklch, var(--color-status-danger) 16%, transparent);
  color: var(--color-status-danger);
}
:root .proto-ui.proto-ui.proto-ui .mar-menu-ask-btn.is-danger:hover {
  background: color-mix(in oklch, var(--color-status-danger) 24%, transparent);
}
.mar-menu-hint {
  color: var(--color-subtle-foreground);
  font-family: inherit;
  font-size: 11px;
}
</style>
