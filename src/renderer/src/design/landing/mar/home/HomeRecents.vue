<script setup lang="ts">
import { ref } from 'vue'
import HomeSectionHeader from '../HomeSectionHeader.vue'
import RecentList, { type RecentListRow } from '../RecentList.vue'
import { go } from '../../useProto'
import { openCreate } from '../create/createScreen'

defineProps<{ rows: RecentListRow[] }>()
const emit = defineEmits<{ open: [id: string] }>()
const active = ref<string>()
</script>

<template>
  <section>
    <HomeSectionHeader
      title="Recently used"
      link-tip="All workflows"
      add-label="New workflow"
      add="always"
      @open="go('workflows')"
      @add="openCreate()"
    />
    <RecentList
      :rows="rows"
      :active="active"
      @hover="(id) => (active = id)"
      @open="(row) => emit('open', row.id)"
    />
  </section>
</template>
