<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../ui/Button.vue'
import DialogContent from '../ui/DialogContent.vue'
import { shownWorkspace as workspace } from '../account'
import { creditsState, creditsTotal } from './credits'
import { runBlock, type RunBlock } from './runCredits'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ resolved: [] }>()

const isOwner = computed(() => workspace.value.role?.toUpperCase() !== 'MEMBER')
const shown = ref<RunBlock>()
const working = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

const canAct = computed(() => Boolean(shown.value && (!shown.value.ownerOnly || isOwner.value)))

watch(open, (v) => {
  clearTimeout(timer)
  working.value = false
  if (!v) return
  shown.value = runBlock.value
  if (shown.value?.auto) settle(1600)
})

function settle(ms: number): void {
  working.value = true
  timer = setTimeout(() => {
    creditsState.id = 'active'
    working.value = false
    open.value = false
    emit('resolved')
  }, ms)
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent v-if="shown" size="sm" class="mar-rcs z-[63] p-6">
      <DialogTitle class="pr-6 text-heading font-semibold">{{ shown.title }}</DialogTitle>
      <DialogDescription class="mt-1 text-ui text-muted-foreground">
        {{ shown.message }}
      </DialogDescription>
      <p v-if="shown.balance" class="mt-4 text-ui text-subtle-foreground tabular-nums">
        Balance · {{ creditsTotal }} credits
      </p>
      <p v-if="!canAct && shown.memberNote" class="mt-4 text-ui text-subtle-foreground">
        {{ shown.memberNote }}
      </p>
      <Button
        v-if="shown.auto || (canAct && shown.action)"
        variant="primary"
        size="lg"
        block
        class="mt-6"
        :disabled="working"
        @click="settle(700)"
        >{{ working ? shown.busy : shown.action }}</Button
      >
      <Button
        variant="ghost"
        block
        :class="canAct || shown.auto ? 'mt-2' : 'mt-6'"
        @click="open = false"
        >Cancel</Button
      >
    </DialogContent>
  </DialogRoot>
</template>

<style>
.proto-ui:has(+ .mar-rcs) {
  z-index: 63;
}
</style>
