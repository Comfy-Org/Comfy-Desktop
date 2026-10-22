<script setup lang="ts">
import { computed, ref } from 'vue'
import { Download } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import MemberAvatar from '../../parts/MemberAvatar.vue'
import type { Space } from '../../spaces'
import { toast } from '../../useProto'

/** Audit log: every run, change and invite in the space. */
const { space } = defineProps<{ space: Space }>()
const who = ref<'all' | 'client' | 'studio'>('all')
const list = computed(() =>
  space.activity.filter((a) => who.value === 'all' || (who.value === 'studio') === !!a.studio)
)
</script>

<template>
  <div class="mt-8 mb-3 flex items-center justify-between">
    <SegmentedControl
      v-model="who"
      variant="contained"
      :options="[
        { value: 'all', label: 'All' },
        { value: 'client', label: 'Client' },
        { value: 'studio', label: 'Studio' }
      ]"
    />
    <Button @click="toast('Exported audit-log.csv')"><Download :size="13" />Export</Button>
  </div>
  <Card class="divide-y divide-border-default">
    <div v-for="(a, i) in list" :key="i" class="flex items-center gap-3 px-5 py-3">
      <MemberAvatar :name="a.who" size="sm" />
      <p class="min-w-0 flex-1 truncate text-ui">
        <span class="font-medium">{{ a.who }}</span>
        <span class="ml-1 text-muted-foreground">{{ a.what }}</span>
      </p>
      <Badge v-if="a.studio" size="sm">Studio</Badge>
      <span class="w-24 text-right text-ui text-subtle-foreground">{{ a.when }}</span>
    </div>
  </Card>
</template>
