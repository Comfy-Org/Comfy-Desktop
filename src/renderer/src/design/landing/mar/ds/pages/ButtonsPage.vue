<script setup lang="ts">
import { ArrowUp, Bell, Download, MoreHorizontal, Mic, Play, Plus, Workflow } from 'lucide-vue-next'
import Button from '../../../ui/Button.vue'
import portraitSun from '../../assets/portrait-sun.jpg'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'

const VARIANTS = [
  {
    v: 'primary',
    label: 'Create',
    note: 'The one white CTA per screen (Create, Try it). Never blue: to make something stand out, use the white primary, order and size, not colour.'
  },
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
  <Section
    title="Corners"
    note="Buttons use the control radius (--radius-control), so they follow the Corners tweak. Only icon-only circular buttons are round (send, play, an arrow on a picture). No pill buttons; pills are for tags and badges."
  >
    <Cells :min="140">
      <Cell label="text · control radius"><Button variant="primary">Log in</Button></Cell>
      <Cell label="on a picture · control radius">
        <div class="ds-photo ds-btn-photo" :style="{ backgroundImage: `url(${portraitSun})` }">
          <Button variant="primary"><Play :size="12" fill="currentColor" />Run</Button>
        </div>
      </Cell>
      <Cell label="icon-only · round">
        <Button variant="primary" size="icon" aria-label="Send" class="rounded-full!"
          ><ArrowUp :size="15"
        /></Button>
      </Cell>
    </Cells>
  </Section>
  <Section
    title="Full width"
    note="A full-width button centres its label, primary or not; an icon goes before the label, centred with it (the asset view's Download and Open workflow, a modal's main action). Only menu rows and pickers start at the left."
  >
    <Cells :min="280">
      <Cell label="primary · icon and label centred">
        <div class="ds-btn-wide">
          <Button variant="primary" class="w-full"><Download :size="14" />Download</Button>
        </div>
      </Cell>
      <Cell label="secondary · centred">
        <div class="ds-btn-wide">
          <Button variant="subtle" class="w-full"><Workflow :size="14" />Open workflow</Button>
        </div>
      </Cell>
      <Cell label="hover" force="hover" target="button">
        <div class="ds-btn-wide">
          <Button variant="subtle" class="w-full"><Workflow :size="14" />Open workflow</Button>
        </div>
      </Cell>
    </Cells>
  </Section>
  <Section
    title="Icon buttons hover square"
    note="In panels and headers an icon button hovers square, radius 8, never a circle (a modal's More, a header's + or ⋯). One tool per header: + when you can add, ⋯ when there's more; if ⋯ already has Add, no + beside it."
  >
    <Cells :min="140">
      <Cell label="idle"
        ><Button variant="ghost" size="icon-sm" aria-label="More"
          ><MoreHorizontal :size="16" /></Button
      ></Cell>
      <Cell label="hover" force="hover" target="button"
        ><Button variant="ghost" size="icon-sm" aria-label="More"
          ><MoreHorizontal :size="16" /></Button
      ></Cell>
      <Cell label="focus" force="focus" target="button"
        ><Button variant="ghost" size="icon-sm" aria-label="More"
          ><MoreHorizontal :size="16" /></Button
      ></Cell>
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
.ds-btn-wide {
  width: 240px;
}
.ds-btn-photo {
  min-height: 64px;
  align-items: center;
  justify-content: center;
}
</style>
