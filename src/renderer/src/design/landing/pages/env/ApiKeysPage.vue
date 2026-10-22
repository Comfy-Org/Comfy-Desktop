<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import PageHeader from '../../ui/PageHeader.vue'
import { toast } from '../../useProto'

const KEYS = [
  { name: 'Production server', prefix: 'ck_live_8f2a…', created: 'Aug 31', used: '2 min ago' },
  { name: 'Staging', prefix: 'ck_live_31c9…', created: 'Sep 3', used: 'Yesterday' }
]
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader
      title="API keys"
      description="Workspace keys for calling dedicated builds from your code."
    >
      <template #actions
        ><Button variant="primary" size="lg" @click="toast('New API key')"
          ><Plus :size="15" />New key</Button
        ></template
      >
    </PageHeader>
    <Card class="overflow-hidden">
      <div
        class="grid h-10 grid-cols-[minmax(0,1fr)_200px_120px_120px] items-center gap-4 border-b border-border-default bg-secondary-background/40 px-5 text-ui text-subtle-foreground"
      >
        <span>Name</span><span>Key</span><span>Created</span><span>Last used</span>
      </div>
      <div
        v-for="k in KEYS"
        :key="k.name"
        class="grid min-h-12 grid-cols-[minmax(0,1fr)_200px_120px_120px] items-center gap-4 border-b border-border-default px-5 last:border-b-0"
      >
        <span>{{ k.name }}</span
        ><code class="font-mono text-ui text-muted-foreground">{{ k.prefix }}</code>
        <span class="text-ui text-subtle-foreground">{{ k.created }}</span
        ><span class="text-ui text-subtle-foreground">{{ k.used }}</span>
      </div>
    </Card>
  </div>
</template>
