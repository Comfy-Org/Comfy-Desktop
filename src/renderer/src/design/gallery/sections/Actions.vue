<script setup lang="ts">
import { Play, Plus, Trash2 } from 'lucide-vue-next'
import Badge from '../../landing/ui/Badge.vue'
import Button from '../../landing/ui/Button.vue'
import GallerySection from '../parts/GallerySection.vue'
import Specimen from '../parts/Specimen.vue'
import VariantGroup from '../parts/VariantGroup.vue'
import Stage from '../parts/Stage.vue'
import { state } from '../playground'
import { thumb } from '../../landing/mock'

const VARIANTS = ['primary', 'secondary', 'subtle', 'ghost', 'link', 'destructive'] as const
const SIZES = ['sm', 'md', 'lg'] as const
const ICON_SIZES = ['icon-xs', 'icon-sm', 'icon'] as const
const BADGES = ['default', 'outline', 'solid'] as const
const b = state.button
const g = state.badge
</script>

<template>
  <GallerySection
    id="button"
    title="Button"
    description="One primary per surface. Secondary is the default; ghost for toolbars and lists; destructive only for irreversible actions."
    tweak-key="button"
  >
    <Stage>
      <Button
        :variant="b.variant as never"
        :size="b.size as never"
        :disabled="!!b.disabled"
        :block="!!b.block"
        ><Play v-if="b.icon" :size="13" />{{ b.label }}</Button
      >
    </Stage>
    <VariantGroup
      title="Variant"
      prop="variant"
      note="What the action is: one primary per surface."
    >
      <Specimen v-for="v in VARIANTS" :key="v" :label="v">
        <Button :variant="v">{{ v === 'destructive' ? 'Delete' : 'Continue' }}</Button>
      </Specimen>
      <Specimen label="overlay" bleed>
        <img
          :src="thumb('template_product_placement')"
          alt=""
          class="absolute inset-0 size-full object-cover"
        />
        <Button variant="overlay" size="sm" class="relative">Open</Button>
      </Specimen>
    </VariantGroup>
    <VariantGroup title="Size" prop="size" cell="md">
      <Specimen v-for="s in SIZES" :key="s" :label="s">
        <Button :size="s"><Plus :size="13" />New workflow</Button>
      </Specimen>
    </VariantGroup>
    <VariantGroup title="Icon only" prop="size" note="Needs an aria-label.">
      <Specimen v-for="s in ICON_SIZES" :key="s" :label="s">
        <Button :size="s" variant="ghost" aria-label="Delete"><Trash2 :size="14" /></Button>
      </Specimen>
    </VariantGroup>
    <VariantGroup title="State" prop="disabled">
      <Specimen label="disabled"><Button variant="primary" disabled>Continue</Button></Specimen>
    </VariantGroup>
  </GallerySection>

  <GallerySection
    id="badge"
    title="Badge"
    description="Status and metadata. Never interactive."
    tweak-key="badge"
  >
    <Stage>
      <Badge :variant="g.variant as never" :size="g.size as never">{{ g.label }}</Badge>
    </Stage>
    <VariantGroup title="Variant" prop="variant">
      <Specimen v-for="v in BADGES" :key="v" :label="v"><Badge :variant="v">Draft</Badge></Specimen>
      <Specimen label="overlay" bleed>
        <img :src="thumb('image_flux2')" alt="" class="absolute inset-0 size-full object-cover" />
        <Badge variant="overlay" class="relative">App</Badge>
      </Specimen>
    </VariantGroup>
    <VariantGroup title="Size" prop="size">
      <Specimen label="sm"><Badge>Draft</Badge></Specimen>
      <Specimen label="md"><Badge size="md">v3</Badge></Specimen>
      <Specimen label="tag"><Badge size="tag">Product shots</Badge></Specimen>
    </VariantGroup>
  </GallerySection>
</template>
