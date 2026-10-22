<script setup lang="ts">
import { ref, computed } from 'vue'
import Card from '../../ui/Card.vue'
import PageHeader from '../../ui/PageHeader.vue'
import SearchInput from '../../ui/SearchInput.vue'
import { ROUTER_MODELS } from '../../mock'

/** Comfy Router: partner models you can call directly, no environment needed. */
const q = ref('')
const list = computed(() =>
  ROUTER_MODELS.filter((m) =>
    `${m.provider} ${m.model} ${m.kind}`.toLowerCase().includes(q.value.toLowerCase())
  )
)
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader
      title="Models"
      description="Partner models through one API. No build to manage - pay per call."
    >
      <template #actions
        ><SearchInput v-model="q" placeholder="Search models" class="w-56"
      /></template>
    </PageHeader>
    <Card class="overflow-hidden">
      <div
        class="grid h-10 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_140px] items-center gap-4 border-b border-border-default bg-secondary-background/40 px-4 text-ui font-medium tracking-wider text-subtle-foreground uppercase"
      >
        <span>Model</span><span>Provider</span><span>Type</span
        ><span class="text-right">Price</span>
      </div>
      <div
        v-for="m in list"
        :key="m.model"
        class="grid min-h-12 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_140px] items-center gap-4 border-b border-border-default px-4 last:border-b-0"
      >
        <span class="font-medium">{{ m.model }}</span>
        <span class="text-ui text-muted-foreground">{{ m.provider }}</span>
        <span class="text-ui text-muted-foreground">{{ m.kind }}</span>
        <span class="text-right text-ui text-subtle-foreground tabular-nums">{{ m.price }}</span>
      </div>
    </Card>
  </div>
</template>
