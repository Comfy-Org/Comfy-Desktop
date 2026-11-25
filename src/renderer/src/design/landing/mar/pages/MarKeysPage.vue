<script setup lang="ts">
import { KeyRound, Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { toast } from '../../useProto'
import MarPage from './MarPage.vue'

/** API keys (Mar's proposal): workspace keys for calling builds from
 *  code, in the library page frame (MarPage) and the one table. */
const KEYS = [
  { name: 'Production server', prefix: 'ck_live_8f2a…', created: 'Aug 31', used: '2 min ago' },
  { name: 'Staging', prefix: 'ck_live_31c9…', created: 'Sep 3', used: 'Yesterday' }
]
const create = (): void => toast('New API key')
</script>

<template>
  <MarPage
    title="API keys"
    skeleton="list"
    :empty="{
      icon: KeyRound,
      title: 'No API keys yet',
      text: 'A key lets your code call your builds and deployments.',
      action: 'Create a key'
    }"
    @action="create"
  >
    <template #actions="{ state }">
      <Button v-if="state === 'live' || state === 'loading'" variant="primary" @click="create"
        ><Plus :size="15" />Key</Button
      >
    </template>

    <div
      class="mar-table"
      role="table"
      aria-label="API keys"
      style="--mar-grid: minmax(0, 1fr) 200px 120px 120px"
    >
      <div class="mar-table-head" role="row">
        <span role="columnheader">Name</span>
        <span role="columnheader">Key</span>
        <span role="columnheader">Created</span>
        <span role="columnheader" class="is-end">Last used</span>
      </div>
      <div v-for="k in KEYS" :key="k.name" class="mar-table-row" role="row">
        <span class="mar-table-name" role="cell"
          ><span class="mar-table-title">{{ k.name }}</span></span
        >
        <code class="mar-table-cell is-quiet font-mono" role="cell">{{ k.prefix }}</code>
        <span class="mar-table-cell" role="cell">{{ k.created }}</span>
        <span class="mar-table-cell is-end" role="cell">{{ k.used }}</span>
      </div>
    </div>
  </MarPage>
</template>
