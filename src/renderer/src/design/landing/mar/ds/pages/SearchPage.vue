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
    label: 'empty · recent work, suggested templates, quick actions',
    run: 'search',
    crop: PALETTE
  },
  { label: 'keyboard · ↓ slides the raised highlight', run: 'search-empty-keys', crop: PALETTE },
  {
    label: 'typing · grouped by kind, matched letters in bold',
    run: 'search-typed',
    crop: PALETTE
  },
  {
    label: 'active row · Open ↵, Open in Cloud ⌘↵ where it runs there',
    run: 'search-keys',
    crop: PALETTE
  },
  { label: 'scoped · “w␣” searches only workflows', run: 'search-scoped', crop: PALETTE },
  { label: 'scoped · “temp⇥” completes the scope', run: 'search-tab', crop: PALETTE },
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
    note="Everything in one place: templates, workflows, projects, spaces, apps, assets and quick actions. Sizes to what it shows. Scope with the chips, a prefix (w, p, s, a, t or as, then a space), or Tab; ⌫ on an empty field searches everything again. Live: type in it."
    :shots="SHOTS"
  />
</template>
