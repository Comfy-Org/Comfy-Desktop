<script setup lang="ts">
import { computed } from 'vue'
import Input from '../../landing/ui/Input.vue'
import SegmentedControl from '../../landing/ui/SegmentedControl.vue'
import Select from '../../landing/ui/Select.vue'
import Switch from '../../landing/ui/Switch.vue'
import type { Control } from '../playground'

/** One prop control in the Component tab, picked by control type. */
const { control } = defineProps<{ control: Control }>()
const model = defineModel<string | boolean>({ required: true })
const text = computed({
  get: () => String(model.value),
  set: (v: string) => (model.value = v)
})
const flag = computed({
  get: () => Boolean(model.value),
  set: (v: boolean) => (model.value = v)
})
const options = computed(() =>
  'options' in control ? control.options.map((o) => ({ value: o, label: o })) : []
)
</script>

<template>
  <Switch v-if="control.type === 'toggle'" v-model="flag" :label="control.label" />
  <label v-else class="flex flex-col gap-2">
    <span class="text-ui text-muted-foreground">{{ control.label }}</span>
    <SegmentedControl
      v-if="control.type === 'segment'"
      v-model="text"
      size="sm"
      variant="contained"
      :options="options"
    />
    <Select v-else-if="control.type === 'select'" v-model="text" size="sm" :options="options" />
    <Input v-else v-model="text" size="sm" />
  </label>
</template>
