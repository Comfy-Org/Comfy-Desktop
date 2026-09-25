<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import { TID } from '../../../shared/testIds'
import InfoTooltip from './InfoTooltip.vue'
import type { ContextMenuItem } from '../types/context-menu'

const props = defineProps<{
  open: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}>()

const emit = defineEmits<{
  close: []
  select: [id: string]
}>()

const menuRef = ref<HTMLDivElement | null>(null)
const adjustedX = ref(0)
const adjustedY = ref(0)

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      adjustedX.value = props.x
      adjustedY.value = props.y
      await nextTick()
      clampToViewport()
      document.addEventListener('mousedown', onOutsideClick, true)
      document.addEventListener('keydown', onEscape, true)
    } else {
      document.removeEventListener('mousedown', onOutsideClick, true)
      document.removeEventListener('keydown', onEscape, true)
    }
  }
)

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onOutsideClick, true)
  document.removeEventListener('keydown', onEscape, true)
})

function clampToViewport(): void {
  if (!menuRef.value) return
  const rect = menuRef.value.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (adjustedX.value + rect.width > vw) adjustedX.value = vw - rect.width - 4
  if (adjustedY.value + rect.height > vh) adjustedY.value = vh - rect.height - 4
  if (adjustedX.value < 0) adjustedX.value = 4
  if (adjustedY.value < 0) adjustedY.value = 4
}

function onOutsideClick(e: MouseEvent): void {
  const target = e.target as Element
  if (menuRef.value?.contains(target) || target.closest('.tooltip-bubble--interactive')) return
  emit('close')
}

function onEscape(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

function handleClick(item: ContextMenuItem): void {
  if (item.disabled) return
  emit('select', item.id)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && items.length > 0"
      ref="menuRef"
      class="context-menu"
      :style="{ left: adjustedX + 'px', top: adjustedY + 'px' }"
    >
      <template v-for="(item, i) in items" :key="item.id">
        <div v-if="item.separator && i > 0" class="context-menu-separator" />
        <div
          class="context-menu-item"
          :class="{ disabled: item.disabled, 'is-danger': item.style === 'danger' }"
        >
          <button
            class="context-menu-item-action"
            :aria-disabled="item.disabled || undefined"
            :title="item.disabled ? item.title : undefined"
            :data-testid="TID.contextMenuItem(item.id)"
            @click="handleClick(item)"
          >
            {{ item.label }}
          </button>
          <InfoTooltip
            v-if="item.hint"
            class="context-menu-item-info"
            :text="item.hint"
            :link-url="item.hintUrl"
            :link-label="item.hintLinkLabel"
            icon="info"
            side="right"
            @click.stop
          />
        </div>
      </template>
    </div>
  </Teleport>
</template>
