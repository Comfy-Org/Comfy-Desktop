<script setup lang="ts">
import ModeNav from '../../../parts/env/ModeNav.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import ShotsPage, { type Shot } from './ShotsPage.vue'

// The palette, in app pixels (640 wide, 15% from the top of 1280 × 800).
const PALETTE: Shot['crop'] = [296, 96, 688, 680]
const SHOTS: Shot[] = [
  {
    label: 'empty · recent, suggested templates, actions with shortcuts',
    run: 'search',
    crop: PALETTE
  },
  { label: 'keyboard · ↓ moves through one list', run: 'search-empty-keys', crop: PALETTE },
  { label: 'typing · grouped, 3 per group, “See all in …”', run: 'search-typed', crop: PALETTE },
  { label: 'active row · the footer says what ↵ and ⌘↵ do', run: 'search-keys', crop: PALETTE },
  { label: 'scoped · Tab to Workflows, then typing', run: 'search-scoped', crop: PALETTE },
  { label: 'scoped · Tab keeps the query', run: 'search-tab', crop: PALETTE },
  {
    label: 'no results · the shared empty state, docs as the way out',
    run: 'search-none',
    crop: PALETTE
  }
]
</script>

<template>
  <Section
    title="Sidebar row"
    note="Search heads Create's nav, with its shortcut; Build's sidebar has none. It opens the palette, like ⌘K anywhere."
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
    note="One list: a small picture, the name, the type and where it lives. Scopes are the New UI tab group: Tab / ⇧Tab, ←→ on an empty field or ⌘1–7; ⌫ on an empty field goes back to All. The footer says what ↵ does for the row you are on. Live: type in it."
    :shots="SHOTS"
  />
</template>
