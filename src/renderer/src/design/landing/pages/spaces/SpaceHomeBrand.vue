<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Eye, Pencil } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import BrandSettings from '../../parts/space/BrandSettings.vue'
import SectionsEditor from '../../parts/space/SectionsEditor.vue'
import SpaceMark from '../../parts/space/SpaceMark.vue'
import PortalHome from '../../portal/PortalHome.vue'
import { previewSpace, spaceById } from '../../spaces'

/** The space's home page as members see it. Edit opens a compact panel
 *  beside the live preview. */
const { spaceId } = defineProps<{ spaceId: string }>()
const space = computed(() => spaceById(spaceId)!)
const editing = ref(false)
const panel = ref<'sections' | 'brand'>('sections')
</script>

<template>
  <div :class="['mt-8 grid gap-5', editing ? 'grid-cols-[minmax(0,1fr)_300px]' : 'grid-cols-1']">
    <Card class="relative h-[720px] overflow-hidden" :style="{ '--brand': space.brand.color }">
      <div class="flex h-10 items-center gap-3 border-b border-border-default px-4">
        <span class="flex gap-1.5"
          ><span
            v-for="n in 3"
            :key="n"
            class="size-2.5 rounded-full bg-secondary-background-hover"
        /></span>
        <span class="flex-1 truncate text-center text-ui text-subtle-foreground">{{
          space.domain
        }}</span>
        <Button variant="ghost" size="sm" @click="previewSpace(space.id)"
          ><Eye :size="13" />Member view</Button
        >
        <Button :variant="editing ? 'secondary' : 'primary'" size="sm" @click="editing = !editing"
          ><Check v-if="editing" :size="13" /><Pencil v-else :size="13" />{{
            editing ? 'Done' : 'Edit'
          }}</Button
        >
      </div>
      <div class="h-[calc(100%-40px)] overflow-y-auto [scrollbar-width:thin]">
        <div :class="['pointer-events-none relative', editing ? '[zoom:0.66]' : '[zoom:0.82]']">
          <div class="flex h-15 items-center gap-6 px-6">
            <SpaceMark :brand="space.brand" size="sm" named />
            <span class="flex gap-5 text-ui text-muted-foreground"
              ><span class="text-base-foreground">Home</span><span>Tools</span><span>Library</span
              ><span>Requests</span></span
            >
          </div>
          <PortalHome :space />
        </div>
      </div>
    </Card>

    <div v-if="editing" class="flex flex-col gap-4">
      <SegmentedControl
        v-model="panel"
        variant="contained"
        class="w-full [&>*]:flex-1"
        :options="[
          { value: 'sections', label: 'Sections' },
          { value: 'brand', label: 'Brand' }
        ]"
      />
      <SectionsEditor v-if="panel === 'sections'" :space-id="space.id" />
      <BrandSettings v-else :space-id="space.id" />
    </div>
  </div>
</template>
