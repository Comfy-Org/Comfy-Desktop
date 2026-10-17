<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../cn'
import { fieldClass, fieldInputClass } from './field.variants'

defineOptions({ inheritAttrs: false })

const { class: className } = defineProps<{ class?: HTMLAttributes['class'] }>()
const model = defineModel<string>({ default: '' })
</script>

<template>
  <label :class="cn(fieldClass, 'cursor-text', className)">
    <input v-model="model" type="text" v-bind="$attrs" :class="fieldInputClass" />
  </label>
</template>
