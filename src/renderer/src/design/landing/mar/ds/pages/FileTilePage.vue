<script setup lang="ts">
import AssetCover from '../../assets/AssetCover.vue'
import type { MarAsset } from '../../pages/assetsStore'
import AppShot from '../kit/AppShot.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'

/** Files without a picture (assets/AssetCover.vue), one per kind. */
const FILES: { name: string; type: MarAsset['type']; label: string }[] = [
  { name: 'narration_intro.wav', type: 'audio', label: 'sound' },
  { name: 'pyramid_prop.glb', type: '3d', label: '3D' },
  { name: 'notes.md', type: 'text', label: 'text' },
  { name: 'settings.json', type: 'text', label: 'data · JSON' },
  { name: 'palette.csv', type: 'text', label: 'data · table' },
  { name: 'weights.bin', type: 'other', label: 'any other file' }
]
</script>

<template>
  <Section
    title="Kinds"
    note="A file with no picture draws its kind: the kind's own hue washed over a soft tile, a faint hint of what is inside (a waveform, lines of a note, keys of a JSON, a sheet's cells) and the extension as the label. Hue and strength are fixed per kind and mixed into the theme's tokens, so a wall of files sits at one level in light and dark. The same on Desktop and in ComfyUI."
  >
    <Cells :min="200">
      <Cell v-for="f in FILES" :key="f.name" :label="f.label" fill>
        <div class="ds-ft-tile"><AssetCover :name="f.name" :type="f.type" /></div>
      </Cell>
    </Cells>
  </Section>
  <Section title="Small" note="A list row's thumbnail keeps the wash and the kind's icon.">
    <Cells :min="120">
      <Cell v-for="f in FILES" :key="f.name" :label="f.name">
        <div class="ds-ft-small"><AssetCover :name="f.name" :type="f.type" /></div>
      </Cell>
    </Cells>
  </Section>
  <Section title="In place" note="Assets' wall, a text filter on (Filters › More types › Text).">
    <Cells :min="520">
      <AppShot label="Assets" page="assets" run="assets-filters" :crop="[290, 228, 600, 300]" />
    </Cells>
  </Section>
</template>

<style>
.ds-ft-tile {
  position: relative;
  display: flex;
  width: 100%;
  height: 130px;
  overflow: hidden;
  border-radius: 10px;
}
.ds-ft-small {
  position: relative;
  display: flex;
  width: 40px;
  height: 40px;
  overflow: hidden;
  border-radius: 8px;
}
</style>
