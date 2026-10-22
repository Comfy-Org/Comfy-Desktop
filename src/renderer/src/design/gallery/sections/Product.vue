<script setup lang="ts">
import GallerySection from '../parts/GallerySection.vue'
import Specimen from '../parts/Specimen.vue'
import VariantGroup from '../parts/VariantGroup.vue'
import AppCard from '../../landing/parts/AppCard.vue'
import InstanceCard from '../../landing/parts/InstanceCard.vue'
import InstanceGlyph from '../../landing/parts/InstanceGlyph.vue'
import MemberAvatar from '../../landing/parts/MemberAvatar.vue'
import PromptBox from '../../landing/parts/PromptBox.vue'
import RunArt from '../../landing/parts/RunArt.vue'
import TemplateCard from '../../landing/parts/TemplateCard.vue'
import TutorialCard from '../../landing/parts/TutorialCard.vue'
import WorkflowCard from '../../landing/parts/WorkflowCard.vue'
import SpaceCard from '../../landing/parts/space/SpaceCard.vue'
import SpaceMark from '../../landing/parts/space/SpaceMark.vue'
import ToolCard from '../../landing/parts/space/ToolCard.vue'
import { allWorkflows } from '../../landing/gallery'
import { APPS, INSTANCES, TEMPLATES, TUTORIALS } from '../../landing/mock'
import { SPACES } from '../../landing/spaces'

/** Product-level parts, composed from the kit, with mock data. */
const space = SPACES[0]!
</script>

<template>
  <GallerySection
    id="identity"
    title="Identity marks"
    description="Environment glyphs, space logos and people. Composed from Avatar and the brand icons."
  >
    <VariantGroup title="InstanceGlyph" note="One per environment.">
      <Specimen v-for="i in INSTANCES.slice(0, 3)" :key="i.id" :label="i.name">
        <InstanceGlyph :inst="i" size="lg" />
      </Specimen>
    </VariantGroup>
    <VariantGroup title="SpaceMark" note="The space's brand logo.">
      <Specimen v-for="s in SPACES" :key="s.id" :label="s.name">
        <SpaceMark :brand="s.brand" size="md" />
      </Specimen>
    </VariantGroup>
    <VariantGroup title="MemberAvatar" note="Stacked for shared items.">
      <Specimen label="stack of 3">
        <span class="flex -space-x-1"
          ><MemberAvatar name="Maya Chen" /><MemberAvatar name="Tom Reyes" /><MemberAvatar
            name="Ana Silva"
        /></span>
      </Specimen>
    </VariantGroup>
  </GallerySection>

  <GallerySection
    id="prompt"
    title="Prompt box"
    description="The agent input on Home and in the Agent tab."
  >
    <PromptBox target />
  </GallerySection>

  <GallerySection
    id="product-cards"
    title="Product cards"
    description="Every card type in the app, side by side."
  >
    <VariantGroup title="Card type" cell="lg">
      <Specimen label="environment" fill><InstanceCard :inst="INSTANCES[1]!" /></Specimen>
      <Specimen label="workflow" fill
        ><WorkflowCard v-if="allWorkflows[0]" :wf="allWorkflows[0]"
      /></Specimen>
      <Specimen label="space" fill><SpaceCard :space /></Specimen>
      <Specimen label="published tool" fill><ToolCard :item="space.catalog[0]!" /></Specimen>
      <Specimen label="app" fill><AppCard :app="APPS[0]!" /></Specimen>
      <Specimen label="template" fill><TemplateCard :t="TEMPLATES[0]!" /></Specimen>
      <Specimen label="tutorial" fill><TutorialCard :t="TUTORIALS[0]!" /></Specimen>
    </VariantGroup>
  </GallerySection>

  <GallerySection
    id="illustrations"
    title="Illustrations"
    description="Line art for where ComfyUI runs."
  >
    <VariantGroup title="RunArt" prop="kind" cell="md">
      <Specimen label="cloud"><RunArt kind="cloud" class="h-24 w-36" /></Specimen>
      <Specimen label="local"><RunArt kind="local" class="h-24 w-36" /></Specimen>
    </VariantGroup>
  </GallerySection>
</template>
