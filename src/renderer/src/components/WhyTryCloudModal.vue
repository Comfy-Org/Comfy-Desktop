<script setup lang="ts">
import { computed } from 'vue'
import DesktopDialogSurface from './ui/DesktopDialogSurface.vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { Check, X } from 'lucide-vue-next'
import heroUrl from '../assets/first-use/why-cloud-hero.svg'

const emit = defineEmits<{
  close: []
  'try-cloud': []
}>()

const { tm } = useI18n()

const benefits = computed<string[]>(() => {
  const raw = tm('firstUse.whyCloud.benefits')
  return Array.isArray(raw) ? (raw as unknown as string[]) : []
})
</script>

<template>
  <DesktopDialogSurface
    :open="true"
    :aria-label="$t('firstUse.whyCloud.title')"
    overlay-class="why-cloud-overlay fixed inset-0 z-60 grid place-items-center px-[clamp(32px,5vw,80px)] pt-[clamp(72px,10vh,132px)] pb-[clamp(80px,11vh,140px)] bg-neutral-800/70"
    content-class="why-cloud-content relative flex w-[min(100%,calc((100vh_-_clamp(152px,21vh,272px))_*_(916_/_445)))] max-w-full max-h-full aspect-[916/445] overflow-hidden rounded-panel border border-solid border-neutral-100/8 bg-neutral-900"
    @close="emit('close')"
  >
    <Button
      variant="muted-textonly"
      size="icon"
      class="why-cloud-close absolute top-4 right-4 z-2"
      type="button"
      :aria-label="$t('common.close')"
      data-testid="why-cloud-close"
      @click="emit('close')"
    >
      <X :size="18" />
    </Button>
    <div
      class="why-cloud-grid flex-auto grid size-full grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))]"
    >
      <img
        :src="heroUrl"
        class="why-cloud-image block size-full object-cover object-center bg-[linear-gradient(135deg,var(--neutral-800)_0%,var(--neutral-900)_100%)]"
        :alt="$t('firstUse.whyCloud.imageAlt')"
      />
      <div
        class="why-cloud-body flex flex-col justify-between overflow-auto p-[clamp(1.5rem,2.5vw,2.5rem)]"
      >
        <div
          class="why-cloud-body-main flex flex-auto flex-col justify-center gap-[clamp(0.75rem,1.2vw,1.25rem)]"
        >
          <header class="why-cloud-header flex flex-wrap items-center gap-3">
            <h2
              class="why-cloud-title m-0 font-display text-[length:var(--takeover-fs-h2)] leading-8 font-extrabold tracking-normal text-neutral-100"
            >
              {{ $t('firstUse.whyCloud.title') }}
            </h2>
          </header>
          <p
            class="why-cloud-lead m-0 font-sans text-[length:var(--takeover-fs-lead)] leading-[normal] font-normal text-neutral-300"
          >
            {{ $t('firstUse.whyCloud.lead') }}
          </p>
          <ul
            class="why-cloud-list mt-1 mr-0 mb-0 ml-0 flex list-none flex-col gap-2.5 p-0 [&>li]:grid [&>li]:grid-cols-[auto_1fr] [&>li]:items-start [&>li]:gap-3 [&>li]:text-[length:var(--takeover-fs-lead)] [&>li]:leading-[normal] [&>li]:text-neutral-100"
          >
            <li v-for="b in benefits" :key="b">
              <Check :size="16" class="why-cloud-check mt-[3px] text-comfy-yellow" />
              <span>{{ b }}</span>
            </li>
          </ul>
        </div>
        <footer
          class="why-cloud-footer flex items-center justify-end gap-4 border-t border-solid border-neutral-100/8 pt-[clamp(1rem,1.5vw,1.5rem)]"
        >
          <Button
            size="lg"
            variant="textonly"
            class="why-cloud-maybe whitespace-normal"
            type="button"
            data-testid="why-cloud-maybe"
            @click="emit('close')"
          >
            {{ $t('firstUse.whyCloud.maybeLater') }}
          </Button>
          <Button
            size="lg"
            variant="inverted"
            class="why-cloud-primary whitespace-normal"
            type="button"
            data-testid="why-cloud-try"
            @click="emit('try-cloud')"
          >
            {{ $t('firstUse.whyCloud.tryCta') }}
          </Button>
        </footer>
      </div>
    </div>
  </DesktopDialogSurface>
</template>
