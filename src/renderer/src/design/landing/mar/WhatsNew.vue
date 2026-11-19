<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, ArrowUpRight, Sparkles } from 'lucide-vue-next'
import { ComfyModel } from './icons/comfyIcons'
import Button from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import ScrollRow from '../ui/ScrollRow.vue'
import MediaChip from './MediaChip.vue'
import MarSeg from './pages/MarSeg.vue'
import { toast } from '../useProto'
import { LAUNCHES } from '../mock'

/** Mar's take on Pablo's What's new (parts/LaunchesRow.vue): the tabs say
 *  what they hold, so there is no section title, and the chip on each card
 *  is the DS · Mar media chip. The tabs are MarSeg, like every tab row. */
const tab = ref<'model' | 'feature'>('model')
const list = computed(() => (tab.value === 'model' ? LAUNCHES : [...LAUNCHES].reverse()))
</script>

<template>
  <section class="mt-10">
    <div class="mb-3.5 flex items-center gap-3">
      <MarSeg
        v-model="tab"
        label="What's new"
        :options="[
          { value: 'model', label: 'Latest models' },
          { value: 'feature', label: 'New features' }
        ]"
      />
      <Button variant="link" size="sm" class="ml-auto" @click="toast('All launches')">
        All launches<ArrowUpRight :size="13" />
      </Button>
    </div>
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
        <MediaChip :icon="tab === 'model' ? ComfyModel : Sparkles" class="absolute top-3 left-3">
          {{ tab === 'model' ? 'Model' : 'Feature' }}
        </MediaChip>
        <span
          class="absolute top-1/2 left-4 -translate-y-1/2 text-[22px] font-bold drop-shadow-lg"
          >{{ l.title }}</span
        >
        <!-- A real button, not a chip: control height and radius, an arrow,
             and it brightens with the card's hover. -->
        <span
          class="absolute bottom-3 left-3 inline-flex h-8 items-center gap-1.5 rounded-control bg-inverted-background px-3 text-ui font-medium text-inverted-foreground shadow-[0_6px_20px_-8px_rgb(0_0_0/0.6)] transition-[background-color,transform] duration-200 group-hover:bg-inverted-background-hover group-active:scale-[0.98]"
          >Try it now<ArrowRight
            :size="14"
            class="transition-transform duration-200 group-hover:translate-x-0.5"
        /></span>
      </Card>
    </ScrollRow>
  </section>
</template>
