<script setup lang="ts">
import { Search, X } from 'lucide-vue-next'

/**
 * Search (Assets): the names, as the PRD asks (Better Asset Management,
 * P2-03), and nothing more. Filters live in the Filters menu beside it.
 */
const query = defineModel<string>('query', { required: true })
</script>

<template>
  <label class="mar-pfind asr-field">
    <Search :size="14" />
    <input
      v-model="query"
      type="search"
      placeholder="Search by name…"
      aria-label="Search assets by name"
      @keydown.esc="query = ''"
    />
    <button
      v-if="query"
      type="button"
      class="mar-pfind-x"
      aria-label="Clear search"
      @click="query = ''"
    >
      <X :size="13" />
    </button>
  </label>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .asr-field {
  width: 240px;
}
</style>
