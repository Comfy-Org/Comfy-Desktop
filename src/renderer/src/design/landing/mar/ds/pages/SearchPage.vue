<script setup lang="ts">
import ModeNav from '../../../parts/env/ModeNav.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import ShotsPage, { type Shot } from './ShotsPage.vue'

// The palette, in app pixels.
const PALETTE: Shot['crop'] = [300, 60, 680, 600]
const SHOTS: Shot[] = [
  { label: 'empty · popular templates as pictures, then a list', run: 'search', crop: PALETTE },
  { label: 'typing · results grouped by kind', run: 'search-typed', crop: PALETTE },
  { label: 'keyboard · ↓ moves the highlighted row', run: 'search-keys', crop: PALETTE },
  { label: 'no results', run: 'search-none', crop: PALETTE }
]
</script>

<template>
  <Section
    title="Sidebar row"
    note="Search heads the nav in both lenses, with its shortcut. It opens the palette, like ⌘K anywhere."
  >
    <Cells :min="240">
      <Cell label="idle" on="sidebar" fill><ModeNav mode="create" /></Cell>
      <Cell label="Search hover" on="sidebar" fill force="hover" target="nav > button:first-child">
        <ModeNav mode="create" />
      </Cell>
      <Cell label="Search focus" on="sidebar" fill force="focus" target="nav > button:first-child">
        <ModeNav mode="create" />
      </Cell>
    </Cells>
  </Section>
  <ShotsPage
    title="Palette"
    note="Templates, workflows, projects and spaces in one place. Live: type in it."
    :shots="SHOTS"
  />
</template>
