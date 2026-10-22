<script setup lang="ts">
import { LayoutGrid } from 'lucide-vue-next'
import Badge from '../../landing/ui/Badge.vue'
import Card from '../../landing/ui/Card.vue'
import MediaCard from '../../landing/ui/MediaCard.vue'
import ScrollRow from '../../landing/ui/ScrollRow.vue'
import GallerySection from '../parts/GallerySection.vue'
import Specimen from '../parts/Specimen.vue'
import VariantGroup from '../parts/VariantGroup.vue'
import Stage from '../parts/Stage.vue'
import { state } from '../playground'
import { thumb } from '../../landing/mock'

const c = state.card
const VARIANTS = ['elevated', 'glass', 'dashed', 'inset'] as const
const THUMBS = [
  'template_product_placement',
  'image_flux2',
  'video_ltx2_5_i2v',
  'image_qwen_image_edit_2511',
  'utility_seedvr2_image_upscale',
  'image_z_image_turbo'
]
</script>

<template>
  <GallerySection
    id="card"
    title="Card"
    description="Elevated is the default surface. Glass for floating chrome, dashed for create-new tiles, inset for quiet groups inside a surface."
    tweak-key="card"
  >
    <Stage>
      <Card
        :variant="c.variant as never"
        :padding="c.padding as never"
        :interactive="!!c.interactive"
        class="w-64"
      >
        <p class="text-ui font-medium">Hero shots</p>
        <p class="mt-1 text-ui text-muted-foreground">3 workflows · My Local 1</p>
      </Card>
    </Stage>
    <VariantGroup title="Variant" prop="variant" cell="md">
      <Specimen v-for="v in VARIANTS" :key="v" :label="v" fill>
        <Card :variant="v" padding="md" class="h-24">
          <p class="text-ui font-medium">Hero shots</p>
          <p class="mt-1 text-ui text-muted-foreground">3 workflows</p>
        </Card>
      </Specimen>
    </VariantGroup>
  </GallerySection>

  <GallerySection
    id="media-card"
    :components="['MediaCard']"
    title="Media card"
    description="Image-led card: card 12 with p4 holds media at 8. Corner slots carry overlay badges."
  >
    <ScrollRow :columns="3.4" :min="200">
      <MediaCard v-for="(t, i) in THUMBS" :key="t" :src="thumb(t)" :selected="i === 1">
        <template #top-left>
          <Badge variant="overlay" size="md"><LayoutGrid :size="12" />App</Badge>
        </template>
        <p class="truncate text-ui font-medium">{{ t.replaceAll('_', ' ') }}</p>
      </MediaCard>
    </ScrollRow>
    <p class="text-ui text-subtle-foreground">
      Inside a scroll row (snaps, next card peeks). The second card shows `selected`.
    </p>
  </GallerySection>
</template>
