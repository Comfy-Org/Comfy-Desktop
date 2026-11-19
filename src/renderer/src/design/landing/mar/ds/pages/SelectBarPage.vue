<script setup lang="ts">
import { Download, FolderInput, Tag, Trash2 } from 'lucide-vue-next'
import MarSelectBar from '../../pages/MarSelectBar.vue'
import type { MenuAction } from '../../pages/menu'
import AppShot from '../kit/AppShot.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'

/** The selection bar (pages/MarSelectBar.vue) with Assets' actions. */
const ACTIONS: MenuAction[] = [
  { label: 'Download', icon: Download },
  {
    label: 'Label',
    icon: Tag,
    sub: [{ label: 'Red' }, { label: 'Green' }, { label: 'Blue' }]
  },
  {
    label: 'Move to project',
    icon: FolderInput,
    sub: [{ label: 'Hero shots' }, { label: 'Flux tests' }]
  },
  { label: 'Delete', icon: Trash2, danger: true }
]
</script>

<template>
  <Section
    title="Selection bar"
    note="Selection is the check on a card's hover; once one is picked, the bar rises at the foot, centred on the page's column. Inverted (the page's text colour as its fill), no glass, no edge: the count, Select all, the common actions, Delete last in red. Esc lets go."
  >
    <Cells :min="720">
      <Cell label="two picked" fill>
        <div class="ds-sb-host"><MarSelectBar :n="2" noun="asset" :actions="ACTIONS" /></div>
      </Cell>
      <Cell label="one picked" fill>
        <div class="ds-sb-host">
          <MarSelectBar
            :n="1"
            noun="workflow"
            :actions="ACTIONS.slice(0, 1).concat(ACTIONS.slice(3))"
          />
        </div>
      </Cell>
    </Cells>
  </Section>
  <Section title="In place" note="Assets, two cards picked.">
    <Cells :min="520">
      <AppShot label="Assets" page="assets" run="assets-select" :crop="[290, 560, 960, 240]" />
    </Cells>
  </Section>
</template>

<style>
/* A transformed host holds the fixed bar inside the cell. */
.ds-sb-host {
  position: relative;
  width: 100%;
  height: 96px;
  transform: translateZ(0);
}
</style>
