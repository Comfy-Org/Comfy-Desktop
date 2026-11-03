<script setup lang="ts">
import { computed } from 'vue'
import DesktopDialogSurface from './ui/DesktopDialogSurface.vue'

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
    ariaLabel?: string
    ariaLabelledby?: string
  }>(),
  {
    binding: false,
    opacity: undefined,
    width: 'wide',
    contentClass: '',
    inline: false,
    ariaLabel: undefined,
    ariaLabelledby: undefined
  }
)

const resolvedOpacity = computed<Opacity>(() => props.opacity ?? (props.binding ? 'opaque' : 'dim'))

// Width defaults have zero specificity so contentClass can override them with a utility.
const emit = defineEmits<{
  close: []
}>()
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
  <DesktopDialogSurface
    v-else
    :open="true"
    :aria-label="ariaLabel"
    :aria-labelledby="ariaLabelledby"
    :dismiss-on-escape="!binding"
    :dismiss-on-outside="!binding"
    :overlay-class="[
      'view-modal active fixed inset-0 z-50 flex items-center justify-center',
      resolvedOpacity === 'heavy-dim'
        ? 'view-modal--heavy-dim bg-[var(--overlay-bg-heavy)]'
        : resolvedOpacity === 'opaque'
          ? 'view-modal--opaque bg-[var(--overlay-bg-opaque)]'
          : 'bg-[var(--overlay-bg)]'
    ]"
    :content-class="[
      'mx-[30px] flex h-[calc(100vh-60px)] w-full flex-col overflow-hidden rounded-xl border border-solid border-[var(--border)] bg-[var(--bg)]',
      width === 'regular' ? '[:where(&)]:max-w-[600px]' : '[:where(&)]:max-w-[900px]',
      contentClass
    ]"
    :data-modal-content="width"
    @close="emit('close')"
  >
    <slot />
  </DesktopDialogSurface>
</template>
