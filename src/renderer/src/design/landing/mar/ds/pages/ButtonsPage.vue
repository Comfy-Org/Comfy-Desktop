<script setup lang="ts">
import { ArrowUp, Bell, Mic, Plus } from 'lucide-vue-next'
import Button from '../../../ui/Button.vue'
import portraitSun from '../../assets/portrait-sun.jpg'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'

const VARIANTS = [
  { v: 'primary', label: 'Create', note: 'The one white CTA per surface (Create, Try it).' },
  { v: 'secondary', label: 'Invite', note: 'A lifted surface (Invite, Connect, Docs).' },
  { v: 'ghost', label: 'Credits', note: 'Rows and icon buttons: no fill until hovered.' },
  { v: 'subtle', label: 'Filter', note: 'A soft fill.' },
  { v: 'link', label: 'See all', note: 'Section links.' },
  { v: 'destructive', label: 'Delete', note: 'Irreversible actions only; muted, never bright.' },
  { v: 'overlay', label: 'Open', note: 'On a picture.' }
] as const
const STATES = [
  { label: 'idle', force: '' },
  { label: 'hover', force: 'hover' },
  { label: 'focus', force: 'focus' },
  { label: 'pressed', force: 'hover active' }
]
</script>

<template>
  <Section
    v-for="b in VARIANTS"
    :key="b.v"
    :title="b.v[0]!.toUpperCase() + b.v.slice(1)"
    :note="b.note"
  >
    <Cells :min="120">
      <Cell v-for="s in STATES" :key="s.label" :label="s.label" :force="s.force" target="button">
        <div
          :class="b.v === 'overlay' && 'ds-photo ds-btn-photo'"
          :style="b.v === 'overlay' ? { backgroundImage: `url(${portraitSun})` } : undefined"
        >
          <Button :variant="b.v">{{ b.label }}</Button>
        </div>
      </Cell>
      <Cell label="disabled">
        <div
          :class="b.v === 'overlay' && 'ds-photo ds-btn-photo'"
          :style="b.v === 'overlay' ? { backgroundImage: `url(${portraitSun})` } : undefined"
        >
          <Button :variant="b.v" disabled>{{ b.label }}</Button>
        </div>
      </Cell>
    </Cells>
  </Section>
  <Section title="Sizes and icons" note="sm 28, md 32, lg 36; icon buttons are square.">
    <Cells :min="140">
      <Cell label="sm"><Button variant="secondary" size="sm">Invite</Button></Cell>
      <Cell label="md · with icon"
        ><Button variant="primary"><Plus :size="14" />Create</Button></Cell
      >
      <Cell label="lg"><Button variant="primary" size="lg">Try it</Button></Cell>
      <Cell label="icon-sm · ghost"
        ><Button variant="ghost" size="icon-sm" aria-label="Dictate"><Mic :size="15" /></Button
      ></Cell>
      <Cell label="icon-sm · ghost hover" force="hover" target="button">
        <Button variant="ghost" size="icon-sm" aria-label="Notifications"
          ><Bell :size="15"
        /></Button>
      </Cell>
      <Cell label="icon · send">
        <Button variant="primary" size="icon" aria-label="Send" class="rounded-full!"
          ><ArrowUp :size="15"
        /></Button>
      </Cell>
    </Cells>
  </Section>
</template>

<style>
.ds-btn-photo {
  min-height: 64px;
  align-items: center;
  justify-content: center;
}
</style>
