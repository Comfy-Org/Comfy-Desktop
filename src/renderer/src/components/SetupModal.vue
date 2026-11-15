<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import BrandTakeoverLayout from './BrandTakeoverLayout.vue'
import DesktopDialogSurface from './ui/DesktopDialogSurface.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    dialogLabel: string
    title?: string
    lead?: string
    wide?: boolean
    brandBackdrop?: boolean
    closable?: boolean
    closeTitle?: string
    dismissOnEscape?: boolean
  }>(),
  {
    title: '',
    lead: '',
    wide: false,
    brandBackdrop: false,
    closable: true,
    closeTitle: undefined,
    dismissOnEscape: false
  }
)

const emit = defineEmits<{ close: [] }>()

const hostProps = computed(() =>
  props.brandBackdrop
    ? { scrollContent: true, ariaLabel: props.dialogLabel, dismissible: props.dismissOnEscape }
    : {
        open: true,
        ariaLabel: props.dialogLabel,
        dismissOnEscape: props.dismissOnEscape,
        dismissOnOutside: false,
        overlayClass:
          'setup-modal-overlay fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-6 animate-fade-in motion-reduce:animate-none',
        contentClass: 'setup-modal-surface relative max-w-full outline-none'
      }
)
</script>

<template>
  <component
    :is="brandBackdrop ? BrandTakeoverLayout : DesktopDialogSurface"
    v-bind="hostProps"
    @close="emit('close')"
  >
    <div
      class="setup-modal-frame flex w-full items-center justify-center"
      :class="brandBackdrop && 'min-h-full py-[clamp(1.5rem,4vh,3rem)]'"
    >
      <section
        v-bind="$attrs"
        class="setup-modal-panel relative flex max-h-[calc(100vh-48px)] max-w-full flex-col rounded-[16px] bg-neutral-900 text-left [box-shadow:0_24px_64px_rgb(0_0_0/0.5),inset_0_0_0_1px_rgb(255_255_255/0.06)] animate-pop-in motion-reduce:animate-none"
        :class="wide ? 'w-[min(960px,calc(100vw-48px))]' : 'w-[min(760px,calc(100vw-48px))]'"
      >
        <Button
          v-if="closable"
          size="icon"
          variant="muted-textonly"
          type="button"
          class="setup-modal-close absolute top-0 -right-12 z-2 size-9 rounded-full bg-white/10 text-white hover:bg-white/18 hover:text-white max-[860px]:top-3 max-[860px]:right-3"
          :aria-label="$t('common.close')"
          :title="closeTitle ?? $t('common.close')"
          @click="emit('close')"
        >
          <X :size="18" aria-hidden="true" />
        </Button>

        <div
          class="setup-modal-body min-h-0 flex-auto overflow-y-auto px-8 pt-7 pb-6 [scrollbar-width:thin]"
        >
          <h2
            v-if="title"
            class="setup-modal-title m-0 text-[18px] leading-7 font-semibold tracking-[-0.01em] text-neutral-100"
          >
            {{ title }}
          </h2>
          <p v-if="lead" class="setup-modal-lead m-0 mt-1 text-[13px] leading-5 text-text-muted">
            {{ lead }}
          </p>
          <slot />
        </div>

        <footer
          v-if="$slots.footer"
          class="setup-modal-foot flex min-h-16 flex-none items-center gap-2 px-8 py-3 [box-shadow:inset_0_1px_0_rgb(255_255_255/0.08)]"
        >
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </component>
</template>
