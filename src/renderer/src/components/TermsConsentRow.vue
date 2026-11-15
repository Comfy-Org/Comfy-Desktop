<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import Checkbox from '@comfyorg/design-system/checkbox/Checkbox'

defineProps<{
  accepted: boolean
  nudge: boolean
  hint: string
  idPrefix: string
}>()

const emit = defineEmits<{
  'update:accepted': [accepted: boolean]
  'open-terms': [doc: 'eula' | 'tos']
}>()

const LINK_CLASS =
  'inline h-auto p-0 align-baseline text-xs/[15px] font-normal text-foreground underline underline-offset-2 hover:bg-transparent'
</script>

<template>
  <label
    class="flex w-fit cursor-pointer items-center gap-2.5 text-xs/[15px]"
    :data-testid="`${idPrefix}-consent-tos`"
    :data-nudge="nudge || undefined"
  >
    <Checkbox
      :model-value="accepted"
      class="size-5 shrink-0 rounded-[5px] border-0 bg-white/6 text-[#070709] data-[state=checked]:bg-[#f1f1f3] [&_i]:size-3"
      :class="nudge && 'ring-[3px] ring-[rgb(241_178_52/0.35)]'"
      :aria-describedby="nudge ? `${idPrefix}-agree-hint` : undefined"
      @update:model-value="emit('update:accepted', $event === true)"
    />
    <span class="text-subtle-foreground">
      {{ $t('firstUse.consentTosHintPrefix') }}
      <Button
        type="button"
        variant="textonly"
        size="unset"
        :class="LINK_CLASS"
        :data-testid="`${idPrefix}-eula-link`"
        @click.prevent="emit('open-terms', 'eula')"
        >{{ $t('firstUse.eulaLinkLabel') }}</Button
      >
      {{ $t('firstUse.consentTosHintSep') }}
      <Button
        type="button"
        variant="textonly"
        size="unset"
        :class="LINK_CLASS"
        :data-testid="`${idPrefix}-tos-link`"
        @click.prevent="emit('open-terms', 'tos')"
        >{{ $t('firstUse.tosLinkLabel') }}</Button
      >{{ $t('firstUse.consentTosHintSuffix') }}
      <span
        v-if="nudge"
        :id="`${idPrefix}-agree-hint`"
        class="text-[#f0b135]"
        role="status"
        :data-testid="`${idPrefix}-agree-hint`"
        >{{ hint }}</span
      >
    </span>
  </label>
</template>
