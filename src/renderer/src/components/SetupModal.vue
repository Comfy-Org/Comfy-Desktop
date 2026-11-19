<script setup lang="ts">
import { computed } from 'vue'
import { X } from '@lucide/vue'
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
    anchorTop?: boolean
    brandBackdrop?: boolean
    closable?: boolean
    closeTitle?: string
    dismissOnEscape?: boolean
  }>(),
  {
    title: '',
    lead: '',
    wide: false,
    anchorTop: false,
    brandBackdrop: false,
    closable: true,
    closeTitle: undefined,
    dismissOnEscape: false
  }
)

const emit = defineEmits<{ close: [] }>()

const frameSpacing = computed(() => {
  if (!props.anchorTop) return props.brandBackdrop ? 'min-h-full py-[clamp(1.5rem,4vh,3rem)]' : ''
  if (!props.brandBackdrop) return 'pt-(--setup-top) [--setup-chrome:calc(48px+var(--setup-top))]'
  return 'pt-[calc(var(--setup-top)+clamp(1.5rem,4vh,3rem))] pb-6 -mb-[clamp(2rem,5vw,48px)] [--setup-chrome:calc(var(--setup-top)+clamp(1.5rem,4vh,3rem)+clamp(2rem,5vw,48px)+24px)]'
})

const hostProps = computed(() =>
  props.brandBackdrop
    ? { scrollContent: true, ariaLabel: props.dialogLabel, dismissible: props.dismissOnEscape }
    : {
        open: true,
        ariaLabel: props.dialogLabel,
        dismissOnEscape: props.dismissOnEscape,
        dismissOnOutside: false,
        overlayClass: [
          'setup-modal-overlay fixed inset-0 z-50 grid overflow-y-auto bg-black/70 p-6 animate-fade-in motion-reduce:animate-none',
          props.anchorTop ? 'justify-items-center items-start' : 'place-items-center'
        ].join(' '),
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
      class="setup-modal-frame flex w-full justify-center"
      :class="[
        anchorTop ? 'items-start [--setup-top:clamp(0px,calc(50vh_-_384px),96px)]' : 'items-center',
        frameSpacing
      ]"
    >
      <section
        v-bind="$attrs"
        class="setup-modal-panel relative flex max-w-full flex-col rounded-[16px] bg-neutral-900 text-left [box-shadow:0_24px_64px_rgb(0_0_0/0.5),inset_0_0_0_1px_rgb(255_255_255/0.06)] animate-pop-in motion-reduce:animate-none"
        :class="[
          wide ? 'w-[min(960px,calc(100vw-48px))]' : 'w-[min(760px,calc(100vw-48px))]',
          anchorTop
            ? 'setup-modal-panel--anchored max-h-[calc(100vh-var(--setup-chrome))]'
            : 'max-h-[calc(100vh-48px)]'
        ]"
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
          class="setup-modal-body min-h-0 flex-auto overflow-y-auto px-6 pt-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          :class="anchorTop ? 'pb-4' : 'pb-6'"
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
          class="setup-modal-foot flex flex-none items-center gap-2 p-6 [box-shadow:inset_0_1px_0_rgb(255_255_255/0.08)]"
        >
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </component>
</template>
