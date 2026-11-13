<script setup lang="ts">
import { defineComponent, h, onMounted, ref } from 'vue'
import foxSnow from '../../assets/fox-snow.jpg'
import ZoomControl from '../../assets/ZoomControl.vue'
// The stage's foot gives the control its menu glass (.mad-foot .zc).
import '../../assets/AssetDetail.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import ShotsPage, { type Shot } from './ShotsPage.vue'

/** The asset view (assets/AssetDetail.vue), opened from Assets the way a
 *  click does (appActions.ts), and its zoom control on its own. */
const VIEW: Shot[] = [
  { label: 'a picture', page: 'assets', run: 'asset' },
  { label: 'a clip', page: 'assets', run: 'asset-video' }
]
const ZOOMED: Shot[] = [
  { label: 'zoomed in · to the stage’s edges', page: 'assets', run: 'asset-zoom' },
  { label: 'the zoom’s menu', page: 'assets', run: 'asset-zoom-menu' }
]
const MORE: Shot[] = [{ label: 'More (⋯) by the name', page: 'assets', run: 'asset-more' }]

/** ZoomControl live, at a given zoom, open or not (its menu is `open`). */
const Zoom = defineComponent({
  props: { open: Boolean, compare: { type: Boolean, default: undefined } },
  setup(props) {
    const zoom = ref(100)
    const cmp = ref(props.compare)
    const ctl = ref<InstanceType<typeof ZoomControl>>()
    onMounted(() => {
      if (props.open && ctl.value) ctl.value.open = true
    })
    return () =>
      h(ZoomControl, {
        ref: ctl,
        modelValue: zoom.value,
        'onUpdate:modelValue': (v: number) => (zoom.value = v),
        compare: cmp.value,
        'onUpdate:compare': (v?: boolean) => (cmp.value = v),
        fit: 0.52
      })
  }
})
</script>

<template>
  <ShotsPage
    title="Asset view"
    note="One click on a card opens it. The picture fits the stage; the details are a panel a step lighter beside it (14px corners, no stroke, no shadow), its section titles uppercase labels. More (⋯) sits at the top right by the name; the foot keeps Download and Open workflow, labels centred."
    :shots="VIEW"
  />
  <ShotsPage
    title="Zoom runs to the edges"
    note="Zoomed in, the picture fills the whole stage up to its rounded edges, never a box inside it. The controls on the stage take the menu glass (menus/layers.css), the same as the menu they open, and blur what passes under them."
    :shots="ZOOMED"
  />
  <Section
    title="Zoom control"
    note="assets/ZoomControl.vue, as ComfyUI's canvas has it: Compare beside the percentage when there is a before; the percentage opens Zoom in, Zoom out, Zoom 100% and Zoom to fit with their shortcuts, the slider last. It reads in real size. Shared by the asset view, the workflow modal and the app editor."
  >
    <Cells :min="300">
      <Cell label="closed" fill>
        <div class="ds-av-stage" :style="{ backgroundImage: `url(${foxSnow})` }">
          <footer class="mad-foot"><span /><Zoom /></footer>
        </div>
      </Cell>
      <Cell label="with Compare" fill>
        <div class="ds-av-stage" :style="{ backgroundImage: `url(${foxSnow})` }">
          <footer class="mad-foot"><span /><Zoom :compare="false" /></footer>
        </div>
      </Cell>
      <Cell label="open" fill>
        <div class="ds-av-stage is-tall" :style="{ backgroundImage: `url(${foxSnow})` }">
          <footer class="mad-foot"><span /><Zoom open /></footer>
        </div>
      </Cell>
    </Cells>
  </Section>
  <ShotsPage
    title="More"
    note="Everything past the actions in the foot. Delete last, in red, under a divider."
    :shots="MORE"
  />
</template>

<style>
.ds-av-stage {
  position: relative;
  display: flex;
  width: 100%;
  height: 160px;
  border-radius: 12px;
  background-position: center;
  background-size: cover;
}
.ds-av-stage.is-tall {
  height: 300px;
}
</style>
