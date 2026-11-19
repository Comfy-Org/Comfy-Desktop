<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import { useBuildMenu } from './useBuildMenu'
import type { Installation } from '../../types/ipc'

export interface BuildMenuAnchor {
  getBoundingClientRect: () => DOMRect
}

const {
  build,
  anchor,
  align = 'start',
  returnFocus = null
} = defineProps<{
  build: Installation
  anchor: BuildMenuAnchor
  align?: 'start' | 'end'
  returnFocus?: HTMLElement | null
}>()
const open = defineModel<boolean>('open', { default: false })

const { items, run } = useBuildMenu(() => build)

const reference = computed(() => anchor)

function select(id: string): void {
  void run(id)
}

function onCloseAutoFocus(event: Event): void {
  if (!returnFocus?.isConnected) return
  event.preventDefault()
  returnFocus.focus({ preventScroll: true })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  open.value = false
}

function onWindowBlur(): void {
  if (open.value) open.value = false
}
onMounted(() => window.addEventListener('blur', onWindowBlur))
onBeforeUnmount(() => window.removeEventListener('blur', onWindowBlur))
</script>

<template>
  <Menu
    v-model:open="open"
    :modal="false"
    :reference="reference"
    :align="align"
    :collision-padding="4"
    :side-offset="4"
    class="z-[10000] w-[232px]"
    data-testid="build-menu"
    :data-build-id="build.id"
    @keydown.capture="onKeydown"
    @close-auto-focus="onCloseAutoFocus"
  >
    <template #trigger><span hidden aria-hidden="true" /></template>
    <template v-for="item in items" :key="item.id">
      <MenuSeparator v-if="item.separator" />
      <MenuItem
        :class="item.danger && 'text-destructive focus:text-destructive'"
        :disabled="item.disabled"
        :text-value="item.label"
        :title="item.disabled ? item.title : item.hint"
        :data-testid="`build-menu-${item.id}`"
        @select="select(item.id)"
      >
        <component
          :is="item.icon"
          v-if="item.icon"
          :size="15"
          class="shrink-0"
          aria-hidden="true"
        />
        {{ item.label }}
      </MenuItem>
    </template>
  </Menu>
</template>
