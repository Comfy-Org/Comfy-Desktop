<script setup lang="ts">
import { can } from '../../milestones'
import MarCloudBar from './MarCloudBar.vue'
import MarDock from './MarDock.vue'
import MarSidebar from './MarSidebar.vue'
import { onCloud } from './surface'
import MarBloom from './MarBloom.vue'
import MarWires from './MarWires.vue'
import GradedImage from '../brand/GradedImage.vue'
import MarSearch from '../search/MarSearch.vue'
import QueuePanel from '../p20/QueuePanel.vue'
import InspectorPanel from '../p20/InspectorPanel.vue'
import ShortcutBar from '../p20/ShortcutBar.vue'
import TabsNav from '../p20/TabsNav.vue'
import { p20 } from '../p20/p20'
import {
  altBackground,
  bloomOn,
  heroImage,
  marDockOn,
  marNav,
  marSideOn,
  spaceCover
} from './marShell'
import lastOutput from '../assets/portrait-seaside.jpg'
import './marShell.css'
import './panelsNav.css'
import './light.css'
import './borders.css'
import './homeBackgrounds.css'
import '../menus/layers.css'
import '../motion/motion.css'
import '../motion/tabSlide'
import '../motion/pageTransition'

/**
 * The blurred photo behind the top of a page. It scrolls away with the
 * page and fades into the background. Blurred on purpose: the photos are
 * small, and blur keeps them clean on large and low-resolution screens.
 */
</script>

<template>
  <div v-if="bloomOn" class="mar-backdrop is-bloom" aria-hidden="true"><MarBloom /></div>
  <!-- The quieter alternatives: drawn in CSS (marShell.css), except Your
       latest, which blurs the last thing you made. -->
  <div
    v-else-if="altBackground"
    class="mar-backdrop is-bloom is-alt"
    :class="`is-${altBackground}`"
    aria-hidden="true"
  >
    <img v-if="altBackground === 'output'" :src="lastOutput" alt="" class="mar-bg-output" />
    <GradedImage v-else-if="altBackground === 'grade'" :src="lastOutput" :blur="14" />
    <template v-else>
      <div class="mar-bg" />
      <MarWires v-if="altBackground === 'wires'" />
    </template>
  </div>
  <div v-else-if="heroImage" class="mar-backdrop" aria-hidden="true">
    <img :src="heroImage" alt="" />
  </div>
  <!-- A space: its logo's colours, faint, behind the header. -->
  <div
    v-else-if="spaceCover"
    class="mar-backdrop is-space"
    :style="{ '--cover-bg': spaceCover.bg, '--cover-accent': spaceCover.accent }"
    aria-hidden="true"
  />
  <!-- Milestone 1 is today's dashboard: the light only, no new navigation. -->
  <template v-if="can.builds">
    <MarDock v-if="marDockOn" />
    <MarSidebar v-if="marSideOn" />
    <MarCloudBar v-if="onCloud" />
    <!-- Search finds what Explore brings. -->
    <MarSearch v-if="can.exploreApps" />
    <QueuePanel v-if="p20.panel === 'queue'" />
    <InspectorPanel v-else-if="p20.panel === 'inspector'" />
    <ShortcutBar v-if="p20.density === 'dense'" />
    <TabsNav v-if="marNav.id === 'tabs'" />
  </template>
</template>

<style scoped>
.mar-backdrop {
  position: absolute;
  inset: 0 0 auto;
  z-index: -1;
  height: 440px;
  overflow: hidden;
  pointer-events: none;
}
.mar-backdrop img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(14px) saturate(0.85);
  opacity: 0.7;
  transform: scale(1.08);
}
.mar-backdrop::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    color-mix(in oklch, var(--color-content-background) 62%, transparent),
    color-mix(in oklch, var(--color-content-background) 45%, transparent) 45%,
    var(--color-content-background) 100%
  );
}
/* A space's cover: the tile's colour washes down from the whole top edge;
   the brand colour glows above the logo, on the left. Faint, and fainter
   in light mode, where a dark tile's colour would read as dirt. */
.mar-backdrop.is-space {
  --cover-bg-mix: 22%;
  --cover-accent-mix: 18%;
  background:
    radial-gradient(
      ellipse 46% 90% at 14% -10%,
      color-mix(in oklch, var(--cover-accent) var(--cover-accent-mix), transparent),
      transparent 72%
    ),
    linear-gradient(
      180deg,
      color-mix(in oklch, var(--cover-bg) var(--cover-bg-mix), transparent),
      transparent 85%
    );
}
.mar-backdrop.is-space::after {
  content: none;
}
:root[data-ds-theme='light'] .mar-backdrop.is-space {
  --cover-bg-mix: 12%;
  --cover-accent-mix: 16%;
}
</style>
