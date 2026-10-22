<script setup lang="ts">
import { computed } from 'vue'
import { Building2, SplitSquareHorizontal, UserRound } from 'lucide-vue-next'
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import Input from '../../ui/Input.vue'
import { spaceById, type Payer } from '../../spaces'

/** Who pays for runs in a space. Members always sign in with a Comfy
 *  account; this only decides whose credits a run uses. */
const { spaceId } = defineProps<{ spaceId: string }>()
const space = computed(() => spaceById(spaceId)!)
const OPTIONS: { value: Payer; label: string; hint: string; icon: unknown }[] = [
  {
    value: 'owner',
    label: 'You pay',
    hint: 'Runs use this space’s budget. Members never see a price.',
    icon: Building2
  },
  {
    value: 'split',
    label: 'Split',
    hint: 'You cover an allowance per member each month, then they pay.',
    icon: SplitSquareHorizontal
  },
  {
    value: 'members',
    label: 'Members pay',
    hint: 'Each run uses the member’s own Comfy credits, plus your markup.',
    icon: UserRound
  }
]
const allowance = computed({
  get: () => String(space.value.allowance),
  set: (v: string) => (space.value.allowance = Number(v.replace(/\D/g, '')) || 0)
})
</script>

<template>
  <RadioGroupRoot v-model="space.payer" class="flex flex-col gap-2 p-4" aria-label="Who pays">
    <RadioGroupItem
      v-for="o in OPTIONS"
      :key="o.value"
      :value="o.value"
      class="flex items-start gap-3 rounded-control border border-border-default px-3.5 py-3 text-left outline-none hover:bg-secondary-background focus-visible:ring-2 focus-visible:ring-border-focus data-[state=checked]:border-base-foreground/60 data-[state=checked]:bg-secondary-background"
    >
      <component :is="o.icon" :size="16" class="mt-0.5 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1">
        <span class="block text-ui font-medium">{{ o.label }}</span>
        <span class="block text-ui text-subtle-foreground">{{ o.hint }}</span>
      </span>
      <span
        class="mt-0.5 size-3.5 shrink-0 rounded-full border border-border-strong"
        :class="space.payer === o.value && 'border-4 border-base-foreground'"
      />
    </RadioGroupItem>
    <div v-if="space.payer === 'split'" class="flex items-center gap-3 px-1 pt-1">
      <span class="flex-1 text-ui text-muted-foreground">Covered per member each month</span>
      <Input v-model="allowance" mono class="w-32"
        ><template #trailing
          ><span class="text-ui text-subtle-foreground">credits</span></template
        ></Input
      >
    </div>
  </RadioGroupRoot>
</template>
