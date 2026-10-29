<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

/**
 * Single modal primitive.
 *
 * - `binding`: true → no click-outside / Esc dismiss; defaults the backdrop to
 *   `opaque`. Caller must provide an explicit close affordance.
 * - `inline`: true → render the content frame only (no Teleport/backdrop/Esc)
 *   for embedding in a panel body; layout stays identical to overlay mode.
 */
type Opacity = 'dim' | 'heavy-dim' | 'opaque'

const props = withDefaults(
  defineProps<{
    binding?: boolean
    opacity?: Opacity
    width?: 'regular' | 'wide'
    /** Extra class(es) appended to the content box. */
    contentClass?: string
    /** Render content frame only (no overlay/backdrop/dismiss). */
    inline?: boolean
  }>(),
  {
    binding: false,
    opacity: undefined,
    width: 'wide',
    contentClass: '',
    inline: false
  }
)

const resolvedOpacity = computed<Opacity>(() => props.opacity ?? (props.binding ? 'opaque' : 'dim'))

// Width defaults have zero specificity so contentClass can override them with a utility.
const emit = defineEmits<{
  close: []
}>()

const overlayRef = ref<HTMLDivElement | null>(null)
const mouseDownOnOverlay = ref(false)

function handleOverlayMouseDown(e: MouseEvent): void {
  mouseDownOnOverlay.value = e.target === overlayRef.value
}

function handleOverlayClick(e: MouseEvent): void {
  if (props.binding) return
  if (e.target === overlayRef.value && mouseDownOnOverlay.value) {
    emit('close')
  }
  mouseDownOnOverlay.value = false
}

function handleKeydown(e: KeyboardEvent): void {
  if (props.binding || props.inline) return
  if (e.key === 'Escape') {
    emit('close')
  }
}

onMounted(() => {
  if (!props.inline) document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  if (!props.inline) document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div
    v-if="inline"
    data-modal-content="inline"
    class="mx-[30px] flex h-full max-w-none w-full flex-col overflow-hidden rounded-none border-none bg-[var(--bg)]"
    :class="contentClass"
  >
    <slot />
  </div>
  <Teleport v-else to="body">
    <div
      ref="overlayRef"
      class="view-modal active fixed inset-0 z-50 flex items-center justify-center"
      :class="
        resolvedOpacity === 'heavy-dim'
          ? 'view-modal--heavy-dim bg-[var(--overlay-bg-heavy)]'
          : resolvedOpacity === 'opaque'
            ? 'view-modal--opaque bg-[var(--overlay-bg-opaque)]'
            : 'bg-[var(--overlay-bg)]'
      "
      @mousedown="handleOverlayMouseDown"
      @click="handleOverlayClick"
    >
      <div
        :data-modal-content="width"
        class="mx-[30px] flex h-[calc(100vh-60px)] w-full flex-col overflow-hidden rounded-xl border border-solid border-[var(--border)] bg-[var(--bg)]"
        :class="[
          width === 'regular' ? '[:where(&)]:max-w-[600px]' : '[:where(&)]:max-w-[900px]',
          contentClass
        ]"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
