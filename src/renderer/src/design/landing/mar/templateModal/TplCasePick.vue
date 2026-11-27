<script setup lang="ts">
import { computed } from 'vue'
import Select from '../../ui/Select.vue'
import { CANT_RUN_CASES } from './templateData'
import { caseOpen, caseTemplateName, closeCase, openCase } from './openCase'

const NONE = 'none'
const options = [
  { value: NONE, label: 'None' },
  ...CANT_RUN_CASES.map((c) => ({
    value: c.id as string,
    label: c.label,
    hint: caseTemplateName(c)
  }))
]

const pick = computed({
  get: () => caseOpen.value?.id ?? NONE,
  set: (id: string) => {
    const c = CANT_RUN_CASES.find((x) => x.id === id)
    if (c) void openCase(c)
    else closeCase()
  }
})
const templateName = computed(() => (caseOpen.value ? caseTemplateName(caseOpen.value) : ''))
</script>

<template>
  <Select v-model="pick" :options="options" class="w-full" />
  <p v-if="templateName" class="truncate text-ui text-subtle-foreground" :title="templateName">
    {{ templateName }}
  </p>
</template>
