<script setup lang="ts">
import { ref } from 'vue'
import { Code, Palette } from 'lucide-vue-next'
import { AgentChat } from '../../icons/agentChat'
import MarFavoritesGroup from '../../shell/MarFavoritesGroup.vue'
import MarSignIn from '../../shell/MarSignIn.vue'
import MarModeSwitch from '../../modes/MarModeSwitch.vue'
import MarGroupTitle from '../../shell/MarGroupTitle.vue'
import ModeNav from '../../../parts/env/ModeNav.vue'
import SidebarGroup from '../../../parts/env/SidebarGroup.vue'
import SpacesGroup from '../../../parts/space/SpacesGroup.vue'
import WorkspaceMenu from '../../../parts/WorkspaceMenu.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'

const MODES = [
  { value: 'create', label: 'Create', icon: Palette },
  { value: 'build', label: 'Build', icon: Code },
  { value: 'agent', label: 'Agent', icon: AgentChat }
]
const create = ref('create')
const build = ref('build')
const agent = ref('agent')
</script>

<template>
  <Section title="Put together" note="The sidebar with the New UI styles, as Home shows it.">
    <Cells :min="260">
      <Cell on="sidebar" class="ds-sidebar">
        <div class="flex w-55 flex-col">
          <div class="mb-3 flex h-8.5 items-center">
            <MarModeSwitch v-model="create" :options="MODES" />
          </div>
          <ModeNav mode="create" />
          <MarFavoritesGroup />
          <SidebarGroup />
          <SpacesGroup />
          <div class="mt-3 flex flex-col gap-2"><WorkspaceMenu /></div>
        </div>
      </Cell>
    </Cells>
  </Section>

  <Section
    title="Mode switch"
    note="Split: Create and Build on a soft track, Agent its own square. Track 10 around 3 of padding, so the segment is 7."
  >
    <Cells :min="240">
      <Cell label="create picked" on="sidebar"
        ><MarModeSwitch v-model="create" :options="MODES"
      /></Cell>
      <Cell label="build picked" on="sidebar"
        ><MarModeSwitch v-model="build" :options="MODES"
      /></Cell>
      <Cell label="agent picked" on="sidebar"
        ><MarModeSwitch v-model="agent" :options="MODES"
      /></Cell>
      <Cell
        label="segment hover"
        on="sidebar"
        force="hover"
        target=".mar-mode-btn:not([aria-checked='true'])"
      >
        <MarModeSwitch v-model="create" :options="MODES" />
      </Cell>
      <Cell label="agent hover" on="sidebar" force="hover" target=".mms-agent">
        <MarModeSwitch v-model="create" :options="MODES" />
      </Cell>
      <Cell
        label="segment focus"
        on="sidebar"
        force="focus"
        target=".mar-mode-btn:not([aria-checked='true'])"
      >
        <MarModeSwitch v-model="create" :options="MODES" />
      </Cell>
    </Cells>
  </Section>

  <Section title="Rows" note="Grey at rest, white with a soft fill when picked or hovered.">
    <Cells :min="240">
      <Cell label="Home picked, rest idle" on="sidebar" fill><ModeNav mode="create" /></Cell>
      <Cell
        label="Explore hover"
        on="sidebar"
        fill
        force="hover"
        target="button::text(Explore), a::text(Explore)"
      >
        <ModeNav mode="create" />
      </Cell>
      <Cell
        label="Explore focus"
        on="sidebar"
        fill
        force="focus"
        target="button::text(Explore), a::text(Explore)"
      >
        <ModeNav mode="create" />
      </Cell>
    </Cells>
  </Section>

  <Section
    title="Group titles"
    note="Projects and Spaces open their overview: the arrow wakes on hover, focus, or while the overview is open."
  >
    <Cells :min="200">
      <Cell label="idle" on="sidebar" fill><MarGroupTitle title="Projects" /></Cell>
      <Cell label="hover" on="sidebar" fill force="hover"><MarGroupTitle title="Projects" /></Cell>
      <Cell label="focus" on="sidebar" fill force="focus"><MarGroupTitle title="Projects" /></Cell>
      <Cell label="overview open" on="sidebar" fill><MarGroupTitle title="Spaces" active /></Cell>
    </Cells>
  </Section>

  <Section
    title="Favorites"
    note="What you starred, up to four; the title opens the whole page. Hidden while nothing is starred. Hover a row to unstar it."
  >
    <Cells :min="240">
      <Cell label="three starred" on="sidebar" fill><MarFavoritesGroup /></Cell>
      <Cell
        label="row hover"
        on="sidebar"
        fill
        force="hover"
        target=".mar-fav-row:nth-child(2), .mar-fav-row:nth-child(2) > button:first-child"
        ><MarFavoritesGroup
      /></Cell>
    </Cells>
  </Section>

  <Section
    title="Groups"
    note="Projects (where each runs on the right) and Spaces (16px logos; a draft says so in plain text). Each group has a single way to add, on its title. Empty groups don't show."
  >
    <Cells :min="240">
      <Cell label="projects" on="sidebar" fill><SidebarGroup /></Cell>
      <Cell label="spaces · Spotify is a draft" on="sidebar" fill><SpacesGroup /></Cell>
    </Cells>
  </Section>

  <Section
    title="Foot"
    note="Credits on a soft tile, then the workspace, which opens its menu (Menus)."
  >
    <Cells :min="240">
      <Cell label="idle" on="sidebar" fill><WorkspaceMenu /></Cell>
      <Cell label="credits hover" on="sidebar" fill force="hover" target=".mar-credits-row">
        <WorkspaceMenu />
      </Cell>
      <Cell label="credits focus" on="sidebar" fill force="focus" target=".mar-credits-row">
        <WorkspaceMenu />
      </Cell>
      <Cell
        label="workspace hover"
        on="sidebar"
        fill
        force="hover"
        target="[aria-haspopup='menu']:not(.mar-credits-row)"
      >
        <WorkspaceMenu />
      </Cell>
      <Cell
        label="workspace open"
        on="sidebar"
        fill
        target="[aria-haspopup='menu']:not(.mar-credits-row)"
        :attrs="{ 'data-state': 'open' }"
      >
        <WorkspaceMenu />
      </Cell>
    </Cells>
  </Section>

  <Section
    title="Log in card"
    note="Signed out, at the foot: a strip of three outputs in the Latent grade with the Comfy mark (it drifts on hover), one line, the standard primary Button. On the collapsed Floating panels rail it is one Log in icon."
  >
    <Cells :min="240">
      <Cell label="idle" on="sidebar" fill><MarSignIn /></Cell>
      <Cell label="hover" on="sidebar" fill force="hover" target=".mar-signin"><MarSignIn /></Cell>
    </Cells>
  </Section>
</template>
