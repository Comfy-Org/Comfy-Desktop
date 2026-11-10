<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, nextTick } from 'vue'
import BaseAlert from '../components/ui/BaseAlert.vue'

type SystemModalConfirmStyle = 'primary' | 'danger'
type SystemModalSecondaryStyle = 'primary' | 'danger' | 'default'
type SystemModalAction = 'confirm' | 'cancel' | 'secondary'

interface SystemModalDetailGroup {
  label: string
  items: string[]
}

interface SystemModalSpec {
  id: string
  title: string
  message: string
  details?: SystemModalDetailGroup[]
  confirmLabel: string
  cancelLabel: string
  confirmStyle?: SystemModalConfirmStyle
  secondaryLabel?: string
  secondaryStyle?: SystemModalSecondaryStyle
  theme: { bg: string; text: string }
}

interface Bridge {
  action(payload: { modalId: string; action: SystemModalAction }): void
  ready(): void
  notifyRendered(): void
  onModal(cb: (spec: SystemModalSpec) => void): () => void
}

const bridge = (window as unknown as { __comfySystemModal?: Bridge }).__comfySystemModal

const spec = ref<SystemModalSpec | null>(null)

const tone = computed<'primary' | 'danger'>(() =>
  spec.value?.confirmStyle === 'danger' ? 'danger' : 'primary'
)

function ack(action: SystemModalAction): void {
  const current = spec.value
  if (!current) return
  bridge?.action({ modalId: current.id, action })
}

let unsubModal: (() => void) | undefined

let renderSeq = 0

onMounted(() => {
  unsubModal = bridge?.onModal((next) => {
    spec.value = next
    const seq = ++renderSeq
    void nextTick(() => {
      if (seq !== renderSeq) return
      bridge?.notifyRendered()
    })
  })
  bridge?.ready()
})

onUnmounted(() => {
  unsubModal?.()
})
</script>

<template>
  <BaseAlert
    :open="!!spec"
    :title="spec?.title ?? ''"
    :message="spec?.message ?? ''"
    :button-label="spec?.confirmLabel ?? ''"
    :cancel-label="spec?.cancelLabel ?? ''"
    :tone="tone"
    :secondary-label="spec?.secondaryLabel"
    :secondary-tone="spec?.secondaryStyle ?? 'default'"
    show-cancel
    @close="ack('confirm')"
    @cancel="ack('cancel')"
    @secondary="ack('secondary')"
  >
    <template v-if="spec?.details && spec.details.length > 0" #default>
      <p v-if="spec.message" class="system-modal-message mt-0 mr-0 mb-3 ml-0">{{ spec.message }}</p>
      <div
        v-for="(group, gi) in spec.details"
        :key="`detail-${gi}`"
        class="system-modal-detail-group [&+.system-modal-detail-group]:mt-2.5"
      >
        <p
          class="system-modal-detail-label mt-0 mr-0 mb-1 ml-0 text-[12px] font-semibold tracking-[0.04em] text-text-muted uppercase"
        >
          {{ group.label }}
        </p>
        <ul
          class="system-modal-detail-items m-0 pl-[18px] text-[13px] text-neutral-100 [&>li]:leading-[1.5]"
        >
          <li v-for="(item, ii) in group.items" :key="`item-${ii}`">{{ item }}</li>
        </ul>
      </div>
    </template>
  </BaseAlert>
</template>
