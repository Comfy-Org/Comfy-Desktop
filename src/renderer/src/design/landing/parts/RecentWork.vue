<script setup lang="ts">
import { computed } from 'vue'
import MediaCard from '../ui/MediaCard.vue'
import ScrollRow from '../ui/ScrollRow.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import InstanceGlyph from './InstanceGlyph.vue'
import { allWorkflows } from '../gallery'
import { hostActions, instanceById } from '../useProto'
import { thumb } from '../mock'

/** Pick up where you left off: the workflows you used last, newest first,
 *  each opening in its build. */
const items = computed(() =>
  [...allWorkflows.value]
    .sort((a, b) => a.age - b.age)
    .slice(0, 8)
    .map((w) => ({ w, env: w.envId ? instanceById(w.envId) : undefined }))
)
</script>

<template>
  <section v-if="items.length" class="mt-10">
    <SectionHeader title="Recently used" />
    <ScrollRow>
      <MediaCard
        v-for="{ w, env } in items"
        :key="w.id"
        :src="w.thumbId ? thumb(w.thumbId) : undefined"
        @click="env && hostActions.launch(env, w.name)"
        @keydown.enter="env && hostActions.launch(env, w.name)"
      >
        <p class="truncate text-ui font-medium">{{ w.name }}</p>
        <p class="mt-0.5 flex items-center gap-1.5 text-ui text-subtle-foreground">
          <InstanceGlyph v-if="env" :inst="env" size="xs" />{{ env?.name }} · {{ w.modified }}
        </p>
      </MediaCard>
    </ScrollRow>
  </section>
</template>
