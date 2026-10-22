<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUpRight, Box, Sparkles } from 'lucide-vue-next'
import Badge from '../ui/Badge.vue'
import Card from '../ui/Card.vue'
import ScrollRow from '../ui/ScrollRow.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import { toast } from '../useProto'
import { LAUNCHES } from '../mock'

const tab = ref<'model' | 'feature'>('model')
const list = computed(() => (tab.value === 'model' ? LAUNCHES : [...LAUNCHES].reverse()))
</script>

<template>
  <section class="mt-10">
    <SectionHeader title="What's new" link="All launches" @link="toast('All launches')">
      <template #controls>
        <SegmentedControl
          v-model="tab"
          :options="[
            { value: 'model', label: 'Models', icon: Box },
            { value: 'feature', label: 'Features', icon: Sparkles }
          ]"
        />
      </template>
      <template #link-icon><ArrowUpRight :size="13" /></template>
    </SectionHeader>
    <ScrollRow :columns="2.6" :min="300">
      <Card
        v-for="l in list"
        :key="l.title"
        as="button"
        interactive
        class="group relative aspect-video overflow-hidden text-left"
        @click="toast(`Try ${l.title}`)"
      >
        <video
          v-if="l.video"
          :src="l.video"
          autoplay
          muted
          loop
          playsinline
          class="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <span
          class="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.25),transparent_40%,rgb(0_0_0/0.45))]"
        />
        <Badge
          variant="overlay"
          size="sm"
          class="absolute top-3 left-3 rounded-min font-bold tracking-wide uppercase"
        >
          <Box :size="10" />{{ tab }}
        </Badge>
        <span
          class="absolute top-1/2 left-4 -translate-y-1/2 text-[22px] font-bold drop-shadow-lg"
          >{{ l.title }}</span
        >
        <Badge variant="solid" size="sm" class="absolute bottom-3 left-3 font-semibold"
          >Try it now</Badge
        >
      </Card>
    </ScrollRow>
  </section>
</template>
