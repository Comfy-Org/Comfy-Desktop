<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import GradedImage from '../../brand/GradedImage.vue'
import { LATENT_GRADE, SILVER_GRADE, WIRE, tint, type Wire } from '../../brand/imagery'
import WorkflowGradient from '../../brand/WorkflowGradient.vue'
import MarWires from '../../shell/MarWires.vue'
import '../../shell/homeBackgrounds.css'
import forestFog from '../../assets/forest-fog.jpg'
import hillsFog from '../../assets/hills-fog.jpg'
import hillsSunset from '../../assets/hills-sunset.jpg'
import lakeFog from '../../assets/lake-fog.jpg'
import portraitGarden from '../../assets/portrait-garden.jpg'
import portraitGrass from '../../assets/portrait-grass.jpg'
import portraitSeaside from '../../assets/portrait-seaside.jpg'
import portraitSmile from '../../assets/portrait-smile.jpg'
import portraitSun from '../../assets/portrait-sun.jpg'
import portraitWindow from '../../assets/portrait-window.jpg'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'

const BACKGROUNDS = [
  { id: 'canvas', label: 'Canvas · the editor’s dot grid' },
  { id: 'wires', label: 'Wires · a graph traced in light' },
  { id: 'grade', label: 'Latent grade · latest output, duotone' }
]

const COVERS = [
  'Portrait relight',
  'Product shots',
  'Upscale 4x',
  'Storyboard',
  'Style transfer',
  'Inpaint'
]

const RULES = [
  'Chrome stays neutral (Graphite). Colour only comes from pictures; text, buttons and surfaces never take a brand hue.',
  'Palette: ComfyUI’s link colours, one per data type, and nothing else. A picture uses one hue or the Latent grade, never a rainbow.',
  'Grade: every picture we make (category tiles, covers, graded backgrounds) goes through the Latent grade: grey, then MODEL violet in the shadows and LATENT pink in the light. Same subject variety, one look.',
  'Silver: pictures that sit in the chrome (the login strip) take the Silver grade: graphite to near white, hard contrast, no hue.',
  'Tint: cards that each own a topic take one link colour as a monochrome tint, the card filled with a pale wash of the same hue.',
  'Grain: one fine film grain over every treatment, the same tile at its own size (never scaled), about 10%.',
  'Motif: the graph (nodes, wires, sockets, the canvas dots) is cropped by the frame edge and sits behind the top band, never whole and never behind text.',
  'Behind UI the grade’s end that matches the page drops out, so the picture sits in the page instead of on it.',
  'Motion: at most one slow thing at a time (a pulse down a wire); nothing moves with reduced motion.'
]

// Category tiles: varied subjects, one grade (like a sound library's tiles).
const CATEGORIES = [
  { label: 'Portraits', src: portraitWindow },
  { label: 'Landscapes', src: hillsSunset },
  { label: 'Video', src: lakeFog },
  { label: 'Relight', src: portraitSun },
  { label: 'Atmosphere', src: forestFog },
  { label: 'Characters', src: portraitGrass }
]

// Use cases: each card owns one link colour.
const USE_CASES: { title: string; src: string; wire: Wire }[] = [
  { title: 'Product shots in a model’s hand', src: portraitSmile, wire: 'image' },
  { title: 'Characters that stay the same', src: portraitGarden, wire: 'model' },
  { title: 'Restore and upscale old photos', src: hillsFog, wire: 'mask' }
]

const SWATCHES = Object.entries(WIRE) as [Wire, string][]
</script>

<template>
  <Section
    title="Home backgrounds"
    note="Three ways to carry the brand behind Home without a logo: the editor’s canvas, the graph itself, or your own work in the Latent grade. Each sits on the Spotlight’s light. UI Playground › Background."
  >
    <Cells :min="900">
      <Cell v-for="b in BACKGROUNDS" :key="b.id" :label="b.label" fill :height="300">
        <div class="bi-home">
          <div class="mar-backdrop is-bloom is-alt bi-backdrop" :class="`is-${b.id}`">
            <GradedImage v-if="b.id === 'grade'" :src="portraitSeaside" :blur="14" />
            <template v-else>
              <div class="mar-bg" />
              <MarWires v-if="b.id === 'wires'" />
            </template>
          </div>
          <p class="bi-greet">Hi Mar. Let’s create</p>
          <div class="bi-prompt">Put this product in a model’s hand</div>
        </div>
      </Cell>
    </Cells>
  </Section>

  <Section
    title="Art direction"
    note="One treatment across every picture, so the set is recognisable as Comfy before you read a word. The same idea as a voice app whose orbs, tiles and cards all share one grade."
  >
    <ul class="bi-rules">
      <li v-for="r in RULES" :key="r">{{ r }}</li>
    </ul>
  </Section>

  <Section
    title="Palette · the link colours"
    note="ComfyUI’s data types. They already mean something to every Comfy user, so they are the brand’s colour, used one at a time."
  >
    <div class="bi-swatches">
      <div v-for="[name, c] in SWATCHES" :key="name" class="bi-swatch">
        <span class="bi-chip" :style="{ background: c }" />
        <span class="bi-swatch-name">{{ name.toUpperCase() }}</span>
        <span class="bi-swatch-hex">{{ c }}</span>
      </div>
      <div class="bi-swatch">
        <span
          class="bi-chip"
          :style="{
            background: `linear-gradient(90deg, ${LATENT_GRADE.shadow}, ${LATENT_GRADE.light})`
          }"
        />
        <span class="bi-swatch-name">LATENT GRADE</span>
        <span class="bi-swatch-hex">MODEL → LATENT</span>
      </div>
    </div>
  </Section>

  <Section
    title="Category tiles · one grade, any subject"
    note="Portraits, landscapes and video stills all come out in the Latent grade with the same grain. Label bottom-left in white, 14px medium, over a scrim in the grade’s shadow; 14px corners."
  >
    <div class="bi-tiles">
      <figure v-for="c in CATEGORIES" :key="c.label" class="bi-tile">
        <GradedImage :src="c.src" />
        <span class="bi-tile-scrim" />
        <figcaption>{{ c.label }}</figcaption>
      </figure>
    </div>
  </Section>

  <Section
    title="Use-case cards · one link colour each"
    note="A monochrome picture tinted to the card’s colour, the card a pale wash of it, the title, and an arrow. The hue says which kind of work it is; the treatment says Comfy."
  >
    <div class="bi-cards">
      <article
        v-for="u in USE_CASES"
        :key="u.title"
        class="bi-card"
        :style="{ '--bi-hue': WIRE[u.wire] }"
      >
        <GradedImage :src="u.src" :grade="tint(u.wire)" class="bi-card-pic" />
        <h3>{{ u.title }}</h3>
        <span class="bi-card-go"><ArrowRight :size="14" /></span>
      </article>
    </div>
  </Section>

  <Section
    title="Workflow cover · a blur of its own"
    note="When a workflow has no picture: three blurred clouds of colour. The name picks the hues and positions, so each workflow has its own and keeps it; lightness and chroma are fixed, so a grid stays at one level of light."
  >
    <div class="bi-covers">
      <figure v-for="n in COVERS" :key="n">
        <span class="bi-cover"><WorkflowGradient :name="n" /></span>
        <figcaption>{{ n }}</figcaption>
      </figure>
    </div>
  </Section>

  <Section
    title="Silver grade · pictures in the chrome"
    note="Graphite to near white, hard contrast, no hue. Used by the login strip."
  >
    <div class="bi-covers">
      <figure v-for="c in CATEGORIES.slice(0, 3)" :key="c.label">
        <span class="bi-cover"
          ><GradedImage :src="c.src" :grade="SILVER_GRADE" class="size-full"
        /></span>
        <figcaption>{{ c.label }}</figcaption>
      </figure>
    </div>
  </Section>
</template>

<style scoped>
.bi-covers {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.bi-covers figure {
  margin: 0;
}
.bi-covers figcaption {
  margin-top: 6px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
.bi-cover {
  display: block;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: var(--radius-control);
}
.bi-home {
  position: relative;
  display: flex;
  height: 300px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-content-background);
}
/* The Home's backdrop, scaled into the cell. */
.bi-backdrop.bi-backdrop {
  position: absolute;
  inset: 0;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
  mask-image: linear-gradient(to bottom, #000 0%, #000 50%, transparent 100%);
}
.bi-backdrop :deep(.mar-graded),
.bi-backdrop .mar-bg {
  position: absolute;
  inset: 0;
}
.bi-greet {
  position: relative;
  color: var(--color-base-foreground);
  font-size: 20px;
  font-weight: 600;
}
.bi-prompt {
  position: relative;
  width: min(72%, 560px);
  padding: 9px 14px;
  border: 1px solid var(--color-border-default);
  border-radius: 999px;
  background: var(--color-card-background);
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bi-rules {
  display: flex;
  max-width: 720px;
  flex-direction: column;
  gap: 8px;
  padding-left: 18px;
  color: var(--color-muted-foreground);
  font-size: 13px;
  list-style: disc;
}
.bi-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.bi-swatch {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}
.bi-chip {
  width: 96px;
  height: 40px;
  border-radius: 8px;
}
.bi-swatch:last-child .bi-chip {
  width: 160px;
}
.bi-swatch-name {
  color: var(--color-base-foreground);
  font-weight: 500;
}
.bi-swatch-hex {
  color: var(--color-subtle-foreground);
  font-variant-numeric: tabular-nums;
}
.bi-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.bi-tile {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 14px;
}
.bi-tile :deep(.mar-graded) {
  position: absolute;
  inset: 0;
}
.bi-tile-scrim {
  position: absolute;
  inset: 50% 0 0;
  background: linear-gradient(to top, oklch(0.26 0.1 282 / 0.55), transparent);
}
.bi-tile figcaption {
  position: absolute;
  bottom: 10px;
  left: 12px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  text-shadow: 0 1px 8px rgb(0 0 0 / 0.35);
}
.bi-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 10px;
}
.bi-card {
  position: relative;
  display: grid;
  grid-template-columns: 112px 1fr;
  gap: 14px;
  padding: 6px;
  border-radius: 14px;
  background: color-mix(in oklab, var(--bi-hue) 16%, var(--color-card-background));
}
.bi-card-pic {
  height: 112px;
  border-radius: 10px;
}
.bi-card h3 {
  padding: 8px 32px 0 0;
  color: var(--color-base-foreground);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.25;
}
.bi-card-go {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-base-foreground);
  color: var(--color-content-background);
}
</style>
