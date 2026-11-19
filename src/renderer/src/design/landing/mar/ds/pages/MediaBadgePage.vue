<script setup lang="ts">
import { Video } from 'lucide-vue-next'
import neonAlley from '../../assets/tokyo-rain.jpg'
import surf from '../../assets/hills-sunset.jpg'
// The badge and the scrub bar are styled by the Assets page.
import '../../pages/MarAssetsPage.vue'
import AppShot from '../kit/AppShot.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
</script>

<template>
  <Section
    title="On a video"
    note="Bottom left, 8px in: the glass pill (rgb(14 14 16 / 0.28), blur 14px, saturate 1.5) with the video's icon and length. Playing on hover, muted, it counts the time and a bar along the bottom edge follows it and scrubs on a press or a drag."
  >
    <Cells :min="260">
      <Cell label="at rest" fill>
        <div class="ds-mb-pic" :style="{ backgroundImage: `url(${neonAlley})` }">
          <span class="mar-asset-len"><Video :size="12" />0:07</span>
        </div>
      </Cell>
      <Cell label="playing on hover" fill>
        <div class="ds-mb-pic" :style="{ backgroundImage: `url(${surf})` }">
          <span class="mar-asset-len">0:03</span>
          <span class="mar-asset-seek"
            ><span class="mar-asset-seek-track"><i style="width: 42%" /></span
          ></span>
        </div>
      </Cell>
    </Cells>
  </Section>
  <Section
    title="In place"
    note="Only where it tells something: a video's length. No badge on a plain image in Assets; a file without a picture draws its kind instead (Files without a picture). On Apps tiles a title takes the corner on hover and the badge fades."
  >
    <Cells :min="520">
      <AppShot label="Assets" page="assets" :crop="[290, 228, 960, 400]" />
    </Cells>
  </Section>
</template>

<style>
.ds-mb-pic {
  position: relative;
  width: 100%;
  height: 170px;
  overflow: hidden;
  border-radius: 12px;
  background-position: center 30%;
  background-size: cover;
}
</style>
